// Makes the iPhone/iPad app icon and launch screen from one picture.
//
//   npm run app:icons
//
// Uses resources/app-icon.png (square, at least 1024 × 1024, no transparency
// needed) when it exists; otherwise draws a plain placeholder "G" so the app
// builds. Replace the placeholder with the real logo before App Review.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "resources", "app-icon.png");
const assets = path.join(root, "ios", "App", "App", "Assets.xcassets");
const iconOut = path.join(assets, "AppIcon.appiconset", "AppIcon-512@2x.png");
const splashDir = path.join(assets, "Splash.imageset");

const BRAND = "#B3560F"; // --primary in client/src/index.css
const CREAM = "#fdfaf5"; // matches SplashScreen.backgroundColor in capacitor.config.ts

const placeholderSvg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${BRAND}"/>
  <text x="512" y="690" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
        font-size="600" font-weight="700" fill="#ffffff">G</text>
</svg>`;

async function iconImage(size) {
  const input = fs.existsSync(source) ? source : Buffer.from(placeholderSvg(size));
  // App Store icons must be opaque
  return sharp(input).resize(size, size, { fit: "cover" }).flatten({ background: BRAND }).png().toBuffer();
}

async function main() {
  if (!fs.existsSync(assets)) {
    console.error("ios/ is missing. Run `npx cap add ios` first.");
    process.exit(1);
  }
  await sharp(await iconImage(1024)).toFile(iconOut);

  // Launch screen: the icon, centred and rounded, on the cream background
  const mark = 640;
  const rounded = Buffer.from(
    `<svg width="${mark}" height="${mark}"><rect width="${mark}" height="${mark}" rx="${mark * 0.22}" ry="${mark * 0.22}"/></svg>`,
  );
  const logo = await sharp(await iconImage(mark)).composite([{ input: rounded, blend: "dest-in" }]).png().toBuffer();
  const splash = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: CREAM } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();
  for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
    fs.writeFileSync(path.join(splashDir, name), splash);
  }
  console.log(fs.existsSync(source) ? "App icon and launch screen made from resources/app-icon.png" : "Placeholder app icon and launch screen made (add resources/app-icon.png for the real one)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
