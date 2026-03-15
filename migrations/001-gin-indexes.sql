-- GIN indexes for fast array filtering
CREATE INDEX IF NOT EXISTS recipes_cuisines_gin ON recipes USING gin (cuisines);
CREATE INDEX IF NOT EXISTS recipes_meal_type_gin ON recipes USING gin (meal_type);
CREATE INDEX IF NOT EXISTS recipes_allergens_gin ON recipes USING gin (allergens);
CREATE INDEX IF NOT EXISTS recipes_cooking_methods_gin ON recipes USING gin (cooking_methods);
CREATE INDEX IF NOT EXISTS recipes_season_tags_gin ON recipes USING gin (season_tags);
CREATE INDEX IF NOT EXISTS recipes_time_convenience_tags_gin ON recipes USING gin (time_convenience_tags);
