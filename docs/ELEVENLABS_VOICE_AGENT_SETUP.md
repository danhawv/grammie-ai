# ElevenLabs Voice Agent Setup for Grammie

This document explains how to configure your ElevenLabs Conversational AI agent to work with Grammie's agentic voice features.

## Overview

Grammie's voice assistant uses ElevenLabs Conversational AI to provide:
- **Ask Grammie**: General cooking Q&A from the toolbar
- **Hands-Free Cooking Mode**: Recipe-specific guidance from recipe detail pages
- **Agentic Actions**: Add items to pantry, create recipes, update preferences via voice

## Agent Configuration

### 1. Create or Update Your Agent

Go to [ElevenLabs Conversational AI](https://elevenlabs.io/conversational-ai) and create/edit your agent.

### 2. Agent Persona

Configure your agent with the following persona:

```
You are Grammie, a warm and knowledgeable cooking assistant. You help users with:
- Answering cooking questions and providing recipe guidance
- Reading recipe steps aloud during hands-free cooking mode
- Managing their pantry by adding items when they ask
- Creating new recipes from their descriptions
- Remembering their preferences, allergies, and dietary restrictions

When users ask you to perform actions (add to pantry, create recipe, update preferences), 
you should use the available tools to complete these actions. Always confirm when actions are completed.

Be conversational, supportive, and safety-conscious about allergies.
```

### 3. Configure Tools (Webhooks)

Add the following tools to your agent. Replace `YOUR_APP_URL` with your deployed app URL (e.g., `https://your-app.replit.app`).

#### Tool 1: Add to Pantry

```json
{
  "name": "add_to_pantry",
  "description": "Add items to the user's pantry when they say things like 'add milk and eggs to my pantry' or 'I just bought chicken and vegetables'",
  "parameters": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "description": "List of items to add to pantry",
        "items": {
          "type": "object",
          "properties": {
            "name": {"type": "string", "description": "Name of the item"},
            "quantity": {"type": "number", "description": "Quantity (optional)"},
            "unit": {"type": "string", "description": "Unit like cups, lbs, count (optional)"},
            "category": {"type": "string", "description": "Category like Dairy, Produce, Meat (optional)"}
          },
          "required": ["name"]
        }
      }
    },
    "required": ["items"]
  },
  "webhook": {
    "url": "YOUR_APP_URL/api/voice/pantry/add",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer {{session_token}}",
      "Content-Type": "application/json"
    }
  }
}
```

#### Tool 2: List Pantry

```json
{
  "name": "list_pantry",
  "description": "List items in the user's pantry when they ask 'what's in my pantry?' or 'what ingredients do I have?'",
  "parameters": {
    "type": "object",
    "properties": {
      "category": {"type": "string", "description": "Filter by category (optional)"},
      "limit": {"type": "number", "description": "Number of items to return (default 20)"}
    }
  },
  "webhook": {
    "url": "YOUR_APP_URL/api/voice/pantry/list",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer {{session_token}}",
      "Content-Type": "application/json"
    }
  }
}
```

#### Tool 3: Update Preferences

```json
{
  "name": "update_preferences",
  "description": "Update user's cooking preferences when they say things like 'remember I'm vegetarian', 'I'm allergic to peanuts', or 'I prefer metric units'",
  "parameters": {
    "type": "object",
    "properties": {
      "allergies": {"type": "array", "items": {"type": "string"}, "description": "Allergies to add"},
      "dietaryRestrictions": {"type": "array", "items": {"type": "string"}, "description": "Diet restrictions like vegetarian, vegan, keto"},
      "dislikedIngredients": {"type": "array", "items": {"type": "string"}, "description": "Ingredients user dislikes"},
      "cookingSkillLevel": {"type": "string", "enum": ["beginner", "intermediate", "advanced", "professional"]},
      "cuisinePreferences": {"type": "array", "items": {"type": "string"}, "description": "Preferred cuisines"},
      "householdSize": {"type": "number", "description": "Number of people in household"},
      "cookingGoals": {"type": "array", "items": {"type": "string"}, "description": "Goals like meal-prep, quick-weeknight, healthy-eating"},
      "grammieNotes": {"type": "string", "description": "Custom notes to remember"},
      "unitSystem": {"type": "string", "enum": ["metric", "us"]}
    }
  },
  "webhook": {
    "url": "YOUR_APP_URL/api/voice/preferences/update",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer {{session_token}}",
      "Content-Type": "application/json"
    }
  }
}
```

#### Tool 4: Create Recipe

```json
{
  "name": "create_recipe",
  "description": "Create a new recipe when the user describes one, like 'create a recipe for garlic butter pasta with...'",
  "parameters": {
    "type": "object",
    "properties": {
      "title": {"type": "string", "description": "Name of the recipe"},
      "description": {"type": "string", "description": "Brief description"},
      "ingredients": {"type": "array", "items": {"type": "string"}, "description": "List of ingredients"},
      "instructions": {"type": "array", "items": {"type": "string"}, "description": "Step by step instructions"},
      "prepTime": {"type": "string", "description": "Prep time like '15 minutes'"},
      "cookTime": {"type": "string", "description": "Cook time like '30 minutes'"},
      "servings": {"type": "number", "description": "Number of servings"},
      "cuisine": {"type": "string", "description": "Cuisine type like Italian, Mexican"},
      "notes": {"type": "string", "description": "Additional notes"}
    },
    "required": ["title", "ingredients", "instructions"]
  },
  "webhook": {
    "url": "YOUR_APP_URL/api/voice/recipe/create",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer {{session_token}}",
      "Content-Type": "application/json"
    }
  }
}
```

#### Tool 5: Get Preferences

```json
{
  "name": "get_preferences",
  "description": "Get the user's current preferences when they ask 'what are my allergies?' or 'what preferences do you know about me?'",
  "parameters": {
    "type": "object",
    "properties": {}
  },
  "webhook": {
    "url": "YOUR_APP_URL/api/voice/preferences/get",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer {{session_token}}",
      "Content-Type": "application/json"
    }
  }
}
```

### 4. Session Token

The `{{session_token}}` variable is passed to the agent via contextual update when the voice session starts. The app automatically:

1. Creates a secure session token when the user starts a call
2. Sends the token to the agent via `sendContextualUpdate()`
3. The agent uses this token in webhook calls for authentication
4. The token expires after 30 minutes

### 5. Environment Variable

Set your agent ID in the environment:

```
VITE_ELEVENLABS_AGENT_ID=your_agent_id_here
```

## API Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/voice/session/start` | POST | Create a voice session (requires auth) |
| `/api/voice/session/end` | POST | End a voice session |
| `/api/voice/session/validate` | GET | Validate a session token |
| `/api/voice/pantry/add` | POST | Add items to pantry |
| `/api/voice/pantry/list` | POST | List pantry items |
| `/api/voice/preferences/get` | POST | Get user preferences |
| `/api/voice/preferences/update` | POST | Update user preferences |
| `/api/voice/recipe/create` | POST | Create a new recipe |

## Testing

1. Open the app and click the mic icon in the toolbar
2. Click "Start Call" to begin
3. Try saying:
   - "Add milk and eggs to my pantry"
   - "What's in my pantry?"
   - "Remember that I'm allergic to peanuts"
   - "Create a recipe for simple pasta with garlic and olive oil"

## Troubleshooting

- **"Voice assistant not configured"**: Set the `VITE_ELEVENLABS_AGENT_ID` environment variable
- **Actions not working**: Check that tools are configured with correct webhook URLs
- **Authentication errors**: Ensure the Authorization header includes `Bearer {{session_token}}`
