import { describe, expect, it } from "vitest";
import { deflateRawSync } from "zlib";
import { exifTakenAt, folderIdFromLink, isPhotoName, naturalCompare, orderPhotos, readZip, sha256Hex, ZipError } from "./bulk-files";

/** A minimal .zip (what Finder makes): entries stored or deflated */
function makeZip(files: { path: string; data: Buffer; deflate?: boolean }[]): Blob {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path);
    const body = f.deflate ? deflateRawSync(f.data) : f.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(f.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Blob([Buffer.concat([...locals, dir, end])]);
}

describe("readZip", () => {
  it("lists and opens stored and deflated files", async () => {
    const card = Buffer.from("pretend jpeg ".repeat(200));
    const zip = makeZip([
      { path: "Grandma/", data: Buffer.alloc(0) },
      { path: "Grandma/IMG_1.jpg", data: card },
      { path: "Grandma/IMG_2.jpg", data: card, deflate: true },
    ]);
    const entries = await readZip(zip);
    expect(entries.map((e) => e.path)).toEqual(["Grandma/IMG_1.jpg", "Grandma/IMG_2.jpg"]);
    for (const e of entries) {
      const out = Buffer.from(await (await e.open()).arrayBuffer());
      expect(out.equals(card)).toBe(true);
    }
  });

  it("explains a damaged file", async () => {
    await expect(readZip(new Blob([Buffer.from("not a zip at all")]))).rejects.toBeInstanceOf(ZipError);
  });
});

describe("isPhotoName", () => {
  it("keeps photos and skips clutter", () => {
    expect(isPhotoName("cards/IMG_0001.JPG")).toBe(true);
    expect(isPhotoName("IMG_0002.heic")).toBe(true);
    expect(isPhotoName("__MACOSX/cards/._IMG_0001.JPG")).toBe(false);
    expect(isPhotoName("cards/._IMG_0001.JPG")).toBe(false);
    expect(isPhotoName(".DS_Store")).toBe(false);
    expect(isPhotoName("notes.txt")).toBe(false);
    expect(isPhotoName("Thumbs.db")).toBe(false);
  });
});

/** A JPEG holding only an EXIF block with DateTimeOriginal */
function jpegWithDate(date: string, little = true): ArrayBuffer {
  const tiff = Buffer.alloc(8 + 18 + 4 + 18 + 4 + 20);
  const w16 = (v: number, o: number) => (little ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o));
  const w32 = (v: number, o: number) => (little ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o));
  tiff.write(little ? "II" : "MM", 0, "ascii");
  w16(42, 2);
  w32(8, 4); // IFD0
  w16(1, 8);
  w16(0x8769, 10); w16(4, 12); w32(1, 14); w32(30, 18); // -> Exif IFD at 30
  w32(0, 22);
  w16(1, 30);
  w16(0x9003, 32); w16(2, 34); w32(20, 36); w32(48, 40); // DateTimeOriginal at 48
  w32(0, 44);
  tiff.write(date + "\0", 48, "ascii");
  const app1Body = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe1, (app1Body.length + 2) >> 8, (app1Body.length + 2) & 0xff]);
  const buf = Buffer.concat([head, app1Body, Buffer.from([0xff, 0xda, 0, 2])]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

describe("exifTakenAt", () => {
  it("reads when the photo was taken", () => {
    expect(exifTakenAt(jpegWithDate("2026:10:09 14:03:22"))).toBe("2026-10-09T14:03:22");
    expect(exifTakenAt(jpegWithDate("2025:01:02 03:04:05", false))).toBe("2025-01-02T03:04:05");
  });

  it("returns null without a date", () => {
    expect(exifTakenAt(jpegWithDate("0000:00:00 00:00:00"))).toBeNull();
    expect(exifTakenAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
  });
});

describe("ordering", () => {
  it("sorts names the way people count", () => {
    expect(["IMG_10.jpg", "IMG_2.jpg", "img_1.jpg"].sort(naturalCompare)).toEqual(["img_1.jpg", "IMG_2.jpg", "IMG_10.jpg"]);
  });

  it("uses capture time only when every photo has one", () => {
    const timed = [
      { path: "b.jpg", takenAt: "2026-01-01T10:00:02", lastModified: 0 },
      { path: "a.jpg", takenAt: "2026-01-01T10:00:05", lastModified: 0 },
    ];
    expect(orderPhotos(timed).map((p) => p.path)).toEqual(["b.jpg", "a.jpg"]);
    expect(orderPhotos([...timed, { path: "c.jpg", takenAt: null, lastModified: 0 }]).map((p) => p.path)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("gives the same id for the same bytes", async () => {
    const a = await sha256Hex(new Blob(["card"]));
    expect(a).toBe(await sha256Hex(new Blob(["card"])));
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("folderIdFromLink", () => {
  it("finds the folder in the links Drive gives out", () => {
    expect(folderIdFromLink("https://drive.google.com/drive/folders/1AbC_dEf-GhIjKlMnOp?usp=sharing")).toBe("1AbC_dEf-GhIjKlMnOp");
    expect(folderIdFromLink("https://drive.google.com/open?id=1AbC_dEf-GhIjKlMnOp")).toBe("1AbC_dEf-GhIjKlMnOp");
    expect(folderIdFromLink("https://example.com/recipes")).toBeNull();
  });
});
