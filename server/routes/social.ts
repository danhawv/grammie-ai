import { Router } from "express";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { storage } from "../storage";

const router = Router();

// Serve OG image for cookbook (for social media previews)
router.get("/og-image/cookbook/:id", async (req: any, res) => {
  try {
    const { id } = req.params;
    const cookbook = await storage.getCookbook(Number(id));

    if (!cookbook) {
      return res.status(404).send("Cookbook not found");
    }

    // Only serve images for public cookbooks
    if (!cookbook.isPublic) {
      return res.status(404).send("Cookbook not found");
    }

    const imageData = cookbook.coverImage;

    if (!imageData) {
      return res.status(404).send("No cover image available");
    }

    // Parse the data URL to extract mime type and base64 data
    const match = imageData.match(/^data:image\/([a-z]+);base64,(.+)$/i);
    if (!match) {
      return res.status(500).send("Invalid image format");
    }

    const imageType = match[1];
    const base64Data = match[2];
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Set cache headers (cache for 1 hour)
    res.set({
      'Content-Type': `image/${imageType}`,
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': imageBuffer.length,
    });

    res.send(imageBuffer);
  } catch (error) {
    console.error("Error serving cookbook OG image:", error);
    res.status(500).send("Failed to serve image");
  }
});

// Serve OG image for recipe (for social media previews)
router.get("/og-image/recipe/:id", async (req: any, res) => {
  try {
    const { id } = req.params;
    const recipe = await storage.getRecipe(id);

    if (!recipe) {
      return res.status(404).send("Recipe not found");
    }

    // Only serve images for public recipes
    if (!recipe.isPublic) {
      return res.status(404).send("Recipe not found");
    }

    // Get the dish image (prefer thumbnail for faster loading, fall back to full image)
    const imageData = recipe.dishImageThumbnail || recipe.dishImage;

    if (!imageData || imageData.startsWith('data:image/svg')) {
      return res.status(404).send("No image available");
    }

    // Parse the data URL to extract mime type and base64 data
    const match = imageData.match(/^data:image\/([a-z]+);base64,(.+)$/i);
    if (!match) {
      return res.status(500).send("Invalid image format");
    }

    const imageType = match[1];
    const base64Data = match[2];
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Set cache headers (cache for 1 hour)
    res.set({
      'Content-Type': `image/${imageType}`,
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': imageBuffer.length,
    });

    res.send(imageBuffer);
  } catch (error) {
    console.error("Error serving OG image:", error);
    res.status(500).send("Failed to serve image");
  }
});

// Open Graph meta tags for social media crawlers (cookbooks) - minimal HTML for bots
router.get("/cookbook/:id", async (req: any, res, next) => {
  const userAgent = req.headers['user-agent']?.toLowerCase() || '';
  const isCrawler = ['facebookexternalhit', 'twitterbot', 'linkedinbot', 'slackbot', 'whatsapp', 'telegrambot', 'imessagebot', 'applebot'].some(bot => userAgent.includes(bot));

  if (!isCrawler) {
    return next(); // Let Vite handle regular users
  }

  try {
    const cookbookId = parseInt(req.params.id);
    if (isNaN(cookbookId)) {
      return next();
    }

    const cookbook = await storage.getCookbook(cookbookId, undefined);
    if (!cookbook) {
      return next();
    }

    // Escape HTML to prevent XSS
    const escapeHtml = (str: string) => str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const title = escapeHtml(cookbook.name || 'Recipe Collection');
    const description = escapeHtml(cookbook.description || 'A collection of delicious recipes');
    const image = escapeHtml(cookbook.coverImage || '');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />
  <title>${title}</title>
</head>
<body>
  <h1>${title}</h1>
  <p>${description}</p>
</body>
</html>`;

    res.type('text/html').send(html);
  } catch (error) {
    console.error("Error generating OG tags for cookbook:", error);
    return next();
  }
});

// Cookbook page with dynamic OG meta tags (HTML replacement for all browsers)
router.get("/cookbook/:id", async (req, res, next) => {
  try {
    const acceptsHtml = req.accepts('html');
    if (!acceptsHtml) {
      return next();
    }

    const { id } = req.params;
    const cookbook = await storage.getCookbook(Number(id));

    if (!cookbook || !cookbook.isPublic) {
      return next();
    }

    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : (process.env.REPLIT_DEPLOYMENT_URL || 'https://grammie.ai');

    const ogTitle = `${cookbook.name} | Grammie`;
    const ogDescription = cookbook.description ||
      `Explore the "${cookbook.name}" cookbook on Grammie. Discover delicious recipes and cooking inspiration.`;
    const ogImage = cookbook.coverImage
      ? `${baseUrl}/og-image/cookbook/${id}`
      : `${baseUrl}/og-image.png`;
    const ogUrl = `${baseUrl}/cookbook/${id}`;

    const isDev = process.env.NODE_ENV === 'development';
    const indexPath = isDev
      ? join(import.meta.dirname, '..', 'client', 'index.html')
      : join(import.meta.dirname, 'public', 'index.html');

    if (!existsSync(indexPath)) {
      return next();
    }

    let html = readFileSync(indexPath, 'utf-8');

    html = html.replace(/<title>.*?<\/title>/, `<title>${ogTitle}</title>`);
    html = html.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${ogTitle}" />`);
    html = html.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${ogDescription.substring(0, 200)}" />`);
    html = html.replace(/<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${ogImage}" />`);
    html = html.replace(/<meta property="og:type" content="[^"]*" \/>/, `<meta property="og:type" content="website" />`);
    html = html.replace(/<meta property="og:site_name" content="[^"]*" \/>/, `<meta property="og:url" content="${ogUrl}" />\n    <meta property="og:site_name" content="Grammie" />`);
    html = html.replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${ogTitle}" />`);
    html = html.replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${ogDescription.substring(0, 200)}" />`);
    html = html.replace(/<meta name="twitter:image" content="[^"]*" \/>/, `<meta name="twitter:image" content="${ogImage}" />`);
    html = html.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${ogDescription.substring(0, 160)}" />`);

    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error("Error serving cookbook page with OG tags:", error);
    next();
  }
});

// Recipe page with dynamic OG meta tags
router.get("/recipe/:id", async (req, res, next) => {
  try {
    const acceptsHtml = req.accepts('html');
    if (!acceptsHtml) {
      return next();
    }

    const { id } = req.params;
    const recipe = await storage.getRecipe(id);

    if (!recipe || !recipe.isPublic) {
      return next();
    }

    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : (process.env.REPLIT_DEPLOYMENT_URL || 'https://grammie.ai');

    const ogTitle = `${recipe.title} | Grammie`;
    const ogDescription = recipe.description ||
      `Discover how to make ${recipe.title}. ${recipe.cuisine ? `A delicious ${recipe.cuisine} dish.` : ''} View the full recipe on Grammie.`;
    const ogImage = `${baseUrl}/og-image/recipe/${id}`;
    const ogUrl = `${baseUrl}/recipe/${id}`;

    const isDev = process.env.NODE_ENV === 'development';
    const indexPath = isDev
      ? join(import.meta.dirname, '..', 'client', 'index.html')
      : join(import.meta.dirname, 'public', 'index.html');

    if (!existsSync(indexPath)) {
      return next();
    }

    let html = readFileSync(indexPath, 'utf-8');

    html = html.replace(/<title>.*?<\/title>/, `<title>${ogTitle}</title>`);
    html = html.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${ogTitle}" />`);
    html = html.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${ogDescription.substring(0, 200)}" />`);
    html = html.replace(/<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${ogImage}" />`);
    html = html.replace(/<meta property="og:type" content="[^"]*" \/>/, `<meta property="og:type" content="article" />`);
    html = html.replace(/<meta property="og:site_name" content="[^"]*" \/>/, `<meta property="og:url" content="${ogUrl}" />\n    <meta property="og:site_name" content="Grammie" />`);
    html = html.replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${ogTitle}" />`);
    html = html.replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${ogDescription.substring(0, 200)}" />`);
    html = html.replace(/<meta name="twitter:image" content="[^"]*" \/>/, `<meta name="twitter:image" content="${ogImage}" />`);
    html = html.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${ogDescription.substring(0, 160)}" />`);

    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error("Error serving recipe page with OG tags:", error);
    next();
  }
});

export default router;
