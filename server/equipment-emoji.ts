/**
 * Equipment emoji mappings
 * Maps common kitchen equipment to appropriate emojis
 */

const equipmentEmojiMap: Record<string, string> = {
  // Knives & Cutting Tools
  'knife': '🔪',
  'chef knife': '🔪',
  'paring knife': '🔪',
  'bread knife': '🔪',
  'cleaver': '🔪',
  'scissors': '✂️',
  'kitchen scissors': '✂️',
  'peeler': '🔪',
  'vegetable peeler': '🔪',
  'grater': '🧀',
  'cheese grater': '🧀',
  'box grater': '🧀',
  'mandoline': '🔪',
  'zester': '🍋',
  
  // Bowls & Containers
  'bowl': '🥣',
  'mixing bowl': '🥣',
  'large bowl': '🥣',
  'medium bowl': '🥣',
  'small bowl': '🥣',
  'glass bowl': '🥣',
  'metal bowl': '🥣',
  'container': '📦',
  'storage container': '📦',
  
  // Pots & Pans
  'pot': '🍲',
  'pan': '🍳',
  'saucepan': '🍲',
  'stockpot': '🍲',
  'dutch oven': '🍲',
  'frying pan': '🍳',
  'skillet': '🍳',
  'cast iron skillet': '🍳',
  'nonstick pan': '🍳',
  'wok': '🍳',
  'roasting pan': '🍳',
  'baking sheet': '🍪',
  'sheet pan': '🍪',
  'cookie sheet': '🍪',
  'baking pan': '🍰',
  'cake pan': '🍰',
  'loaf pan': '🍞',
  'muffin tin': '🧁',
  'pie dish': '🥧',
  'pie pan': '🥧',
  'casserole dish': '🍲',
  'baking dish': '🍲',
  'grill pan': '🍖',
  
  // Utensils
  'spoon': '🥄',
  'wooden spoon': '🥄',
  'slotted spoon': '🥄',
  'ladle': '🥄',
  'spatula': '🍴',
  'turner': '🍴',
  'fish spatula': '🍴',
  'tongs': '🥢',
  'whisk': '🥄',
  'fork': '🍴',
  'serving fork': '🍴',
  'rolling pin': '🥖',
  'can opener': '🥫',
  'bottle opener': '🍺',
  'corkscrew': '🍷',
  
  // Measuring Tools
  'measuring cup': '📏',
  'measuring cups': '📏',
  'measuring spoon': '📏',
  'measuring spoons': '📏',
  'kitchen scale': '⚖️',
  'scale': '⚖️',
  'thermometer': '🌡️',
  'meat thermometer': '🌡️',
  'instant read thermometer': '🌡️',
  'timer': '⏲️',
  'kitchen timer': '⏲️',
  
  // Strainers & Sieves
  'strainer': '🥅',
  'colander': '🥅',
  'sieve': '🥅',
  'fine mesh strainer': '🥅',
  'chinois': '🥅',
  
  // Cutting Boards
  'cutting board': '🪵',
  'chopping board': '🪵',
  
  // Baking Tools
  'oven': '🔥',
  'oven mitt': '🧤',
  'oven mitts': '🧤',
  'pot holder': '🧤',
  'cooling rack': '🍪',
  'wire rack': '🍪',
  'pastry brush': '🖌️',
  'pastry bag': '🎂',
  'piping bag': '🎂',
  'cookie cutter': '🍪',
  
  // Appliances
  'blender': '🌪️',
  'food processor': '⚙️',
  'mixer': '🔄',
  'stand mixer': '🔄',
  'hand mixer': '🔄',
  'immersion blender': '🌪️',
  'electric mixer': '🔄',
  'microwave': '📻',
  'toaster': '🍞',
  'toaster oven': '🍞',
  'rice cooker': '🍚',
  'slow cooker': '🍲',
  'crockpot': '🍲',
  'instant pot': '🍲',
  'pressure cooker': '🍲',
  'air fryer': '🔥',
  'deep fryer': '🔥',
  'coffee maker': '☕',
  'espresso machine': '☕',
  'juicer': '🍊',
  'meat grinder': '🥩',
  'pasta maker': '🍝',
  'bread machine': '🍞',
  
  // Specialized Equipment
  'mortar and pestle': '⚗️',
  'garlic press': '🧄',
  'citrus juicer': '🍋',
  'lemon squeezer': '🍋',
  'salad spinner': '🥗',
  'potato masher': '🥔',
  'ricer': '🥔',
  'cheese cloth': '🧵',
  'cheesecloth': '🧵',
  'kitchen twine': '🧵',
  'butcher twine': '🧵',
  'baster': '🦃',
  'meat mallet': '🔨',
  'ice cream maker': '🍦',
  'waffle iron': '🧇',
  'griddle': '🥞',
  'tortilla press': '🌮',
  'sushi mat': '🍣',
  'bamboo steamer': '🥟',
  'steamer basket': '🥟',
  
  // Specialty
  'sous vide': '🌡️',
  'smoker': '💨',
  'grill': '🔥',
  'barbecue': '🔥',
  'bbq': '🔥',
  'pizza stone': '🍕',
  'pizza peel': '🍕',
  'fondue pot': '🫕',
  'tagine': '🍲',
  'paella pan': '🥘',
  
  // Glassware & Drinkware
  'glass': '🥤',
  'wine glass': '🍷',
  'champagne flute': '🥂',
  'shot glass': '🥃',
  'cocktail shaker': '🍸',
  'shaker': '🍸',
  'jigger': '🥃',
  'muddler': '🍹',
  'bar strainer': '🍸',
  'bar spoon': '🥄',
  
  // Default
  'default': '🔧'
};

/**
 * Get emoji for equipment item
 * Uses partial matching to find best emoji
 */
export function getEquipmentEmoji(equipmentName: string): string {
  if (!equipmentName) return '🔧';
  
  const normalized = equipmentName.toLowerCase().trim();
  
  // Try exact match first
  if (equipmentEmojiMap[normalized]) {
    return equipmentEmojiMap[normalized];
  }
  
  // Try partial matching (check if equipment name contains any key)
  for (const [key, emoji] of Object.entries(equipmentEmojiMap)) {
    if (normalized.includes(key)) {
      return emoji;
    }
  }
  
  // Default emoji for unknown equipment
  return '🔧';
}
