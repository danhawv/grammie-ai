import { type Recipe, type InsertRecipe } from "@shared/schema";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { join } from "path";

const STORAGE_FILE = join(process.cwd(), "recipes-data.json");

interface StorageData {
  recipes: Record<string, Recipe>;
}

export interface IStorage {
  getRecipe(id: string): Promise<Recipe | undefined>;
  getAllRecipes(): Promise<Recipe[]>;
  createRecipe(recipe: InsertRecipe): Promise<Recipe>;
  updateRecipe(
    id: string,
    recipe: Partial<InsertRecipe>
  ): Promise<Recipe | undefined>;
  deleteRecipe(id: string): Promise<boolean>;
}

export class JsonStorage implements IStorage {
  private data!: StorageData;

  constructor() {
    this.loadFromFile();
  }

  private loadFromFile() {
    try {
      if (existsSync(STORAGE_FILE)) {
        const fileContent = readFileSync(STORAGE_FILE, "utf8");
        this.data = JSON.parse(fileContent);
        console.log(`Loaded ${Object.keys(this.data.recipes).length} recipes from storage`);
      } else {
        this.data = { recipes: {} };
        this.saveToFile();
      }
    } catch (error) {
      console.error("Error loading storage file:", error);
      this.data = { recipes: {} };
    }
  }

  private saveToFile() {
    try {
      const tempFile = `${STORAGE_FILE}.tmp`;
      // Write to temp file first
      writeFileSync(tempFile, JSON.stringify(this.data, null, 2), "utf8");
      // Then rename to actual file (atomic operation on most systems)
      renameSync(tempFile, STORAGE_FILE);
    } catch (error) {
      console.error("Error saving storage file:", error);
      throw error; // Bubble up to caller so they know save failed
    }
  }

  async getRecipe(id: string): Promise<Recipe | undefined> {
    return this.data.recipes[id];
  }

  async getAllRecipes(): Promise<Recipe[]> {
    return Object.values(this.data.recipes);
  }

  async createRecipe(insertRecipe: InsertRecipe): Promise<Recipe> {
    // Validate required fields
    if (!insertRecipe.ingredients || insertRecipe.ingredients.length === 0) {
      throw new Error("Recipe must have at least one ingredient");
    }
    if (!insertRecipe.instructions || insertRecipe.instructions.length === 0) {
      throw new Error("Recipe must have at least one instruction");
    }
    
    const id = randomUUID();
    const recipe: Recipe = {
      ...insertRecipe,
      id,
      createdAt: new Date(),
    } as Recipe;
    this.data.recipes[id] = recipe;
    this.saveToFile();
    return recipe;
  }

  async updateRecipe(
    id: string,
    updates: Partial<InsertRecipe>
  ): Promise<Recipe | undefined> {
    const recipe = this.data.recipes[id];
    if (!recipe) return undefined;

    const updated = { ...recipe, ...updates } as Recipe;
    this.data.recipes[id] = updated;
    this.saveToFile();
    return updated;
  }

  async deleteRecipe(id: string): Promise<boolean> {
    if (!this.data.recipes[id]) return false;
    delete this.data.recipes[id];
    this.saveToFile();
    return true;
  }
}

export const storage = new JsonStorage();
