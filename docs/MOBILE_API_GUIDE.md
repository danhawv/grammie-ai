# Grammix Mobile API Integration Guide

This guide documents the JWT-based authentication system for the Grammix mobile app companion.

## Overview

The mobile API uses JWT (JSON Web Tokens) for authentication, providing a seamless authentication experience across the mobile app. The system supports:

- **OAuth Login**: Uses Replit OAuth for authentication, redirecting back to the app via deep links
- **30-day Token Expiration**: Tokens are valid for 30 days with automatic refresh support
- **7-day Refresh Grace Period**: Expired tokens can be refreshed up to 7 days after expiration
- **Dual Authentication**: All API endpoints accept both JWT Bearer tokens (mobile) and cookie sessions (web)

## Deep Link Scheme

The mobile app should register for the following URL schemes:
- **Default**: `grammix://`
- **Custom**: Can be specified via the `scheme` query parameter

## Authentication Endpoints

### Recommended: Simple Token Flow

The simplest and most reliable authentication flow:

**Step 1: User signs in on web**
Open the Grammie AI login page in a web browser:
```
https://grammie-ai.replit.app/api/login
```

**Step 2: Get JWT token via redirect**
After signing in, open this URL to get a JWT token:
```
GET /api/auth/mobile/token?scheme=grammix
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `scheme` | string | `grammix` | Deep link URL scheme for callback. Must be whitelisted: `grammix`, `grammix-dev`, `grammix-staging` |

**Behavior:**
- If user is logged in: Redirects to `grammix://auth/callback?token=<jwt>`
- If user is NOT logged in: Returns HTML page with "Sign In with Replit" button

**Complete Flow:**
1. Mobile app shows "Sign In with Grammie AI" button
2. User taps button → opens `grammie-ai.replit.app/api/login` in browser
3. User completes OAuth with Replit
4. User returns to app and taps "Continue to App"
5. App opens `grammie-ai.replit.app/api/auth/mobile/token?scheme=grammix`
6. Browser redirects to `grammix://auth/callback?token=<jwt>`
7. App receives token via deep link and stores it securely

---

### Alternative: OAuth Login Flow

Start the OAuth flow directly (may have session persistence issues on some browsers):

```
GET /api/auth/mobile/login?scheme=grammix
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `scheme` | string | `grammix` | Deep link URL scheme for callback. Must be whitelisted: `grammix`, `grammix-dev`, `grammix-staging` |

**Flow:**
1. Mobile app opens `/api/auth/mobile/login` in browser
2. User authenticates via Replit OAuth
3. On success, browser redirects to `grammix://auth/callback?token=<jwt>`
4. On failure, browser redirects to `grammix://auth/callback?error=<error_code>`

**Error Codes:**
- `authentication_failed` - OAuth authentication failed
- `user_not_found` - User account doesn't exist
- `oauth_error` - OAuth provider error
- `login_error` - Session login error
- `server_error` - Internal server error

### 2. Check Token Status

Validate the current token and get user information.

```
GET /api/auth/mobile/status
Authorization: Bearer <jwt_token>
```

**Response (200 OK):**
```json
{
  "isAuthenticated": true,
  "shouldRefreshToken": false,
  "tokenExpiresAt": 1738339200,
  "user": {
    "id": "12345678",
    "email": "user@example.com",
    "username": "johndoe",
    "firstName": "John",
    "lastName": "Doe",
    "profileImageUrl": "https://...",
    "preferences": {}
  }
}
```

**Response (401 Unauthorized):**
```json
{
  "isAuthenticated": false,
  "error": "Invalid or expired token",
  "code": "TOKEN_INVALID"
}
```

**Error Codes:**
- `MISSING_TOKEN` - No Authorization header provided
- `TOKEN_INVALID` - Token is invalid or expired
- `USER_NOT_FOUND` - User account no longer exists
- `SERVER_ERROR` - Internal server error

### 3. Refresh Token

Get a new token before the current one expires. Can also refresh recently-expired tokens (within 7 days).

```
POST /api/auth/mobile/refresh
Authorization: Bearer <jwt_token>
```

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "12345678",
    "email": "user@example.com",
    "username": "johndoe",
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

**Response (401 Unauthorized):**
```json
{
  "error": "Token expired beyond refresh window",
  "code": "TOKEN_EXPIRED"
}
```

**Error Codes:**
- `MISSING_TOKEN` - No Authorization header provided
- `INVALID_TOKEN` - Token format is invalid
- `TOKEN_EXPIRED` - Token expired more than 7 days ago
- `USER_NOT_FOUND` - User account no longer exists
- `SERVER_ERROR` - Internal server error

## Using the API

### Making Authenticated Requests

All API endpoints support JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

**Example:**
```javascript
const response = await fetch('https://grammix.app/api/recipes', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

### Token Refresh Strategy

The server includes a header hint when tokens should be refreshed:

```
X-Token-Refresh-Suggested: true
```

**Recommended Implementation:**

```javascript
class TokenManager {
  async makeRequest(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${this.token}`
      }
    });
    
    // Check if refresh is suggested
    if (response.headers.get('X-Token-Refresh-Suggested') === 'true') {
      this.scheduleTokenRefresh();
    }
    
    // Handle token expiration
    if (response.status === 401) {
      const data = await response.json();
      if (data.code === 'TOKEN_INVALID' || data.code === 'TOKEN_EXPIRED') {
        // Try to refresh, or redirect to login
        const refreshed = await this.refreshToken();
        if (refreshed) {
          // Retry the original request
          return this.makeRequest(url, options);
        } else {
          // Token can't be refreshed, redirect to login
          this.redirectToLogin();
        }
      }
    }
    
    return response;
  }
  
  async refreshToken() {
    try {
      const response = await fetch('/api/auth/mobile/refresh', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        this.token = data.token;
        await this.saveToken(data.token);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }
}
```

## JWT Token Structure

The JWT payload contains:

```json
{
  "sub": "12345678",       // User ID
  "email": "user@example.com",
  "iat": 1735747200,       // Issued at timestamp
  "exp": 1738339200        // Expiration timestamp (30 days)
}
```

## Available API Endpoints

All existing API endpoints work with mobile JWT authentication. Here are the key endpoints:

### Recipes
- `GET /api/recipes` - List recipes (supports filtering, pagination)
- `GET /api/recipes/:id` - Get recipe details
- `POST /api/recipes/upload` - Upload recipe image
- `POST /api/recipes/import-social` - Import from Instagram/TikTok
- `POST /api/recipes/extract-url` - Extract from web URL
- `PATCH /api/recipes/:id` - Update recipe
- `DELETE /api/recipes/:id` - Delete recipe

### Cookbooks
- `GET /api/cookbooks` - List user's cookbooks
- `POST /api/cookbooks` - Create cookbook
- `GET /api/cookbooks/:id` - Get cookbook details
- `PATCH /api/cookbooks/:id` - Update cookbook
- `DELETE /api/cookbooks/:id` - Delete cookbook

### Grocery List
- `GET /api/grocery` - Get grocery list
- `POST /api/grocery` - Add items to grocery list
- `PATCH /api/grocery/:id` - Update grocery item
- `DELETE /api/grocery/:id` - Remove grocery item

### Pantry
- `GET /api/pantry` - Get pantry items
- `POST /api/pantry` - Add pantry items
- `POST /api/pantry/scan` - Scan pantry with photo
- `PATCH /api/pantry/:id` - Update pantry item
- `DELETE /api/pantry/:id` - Remove pantry item

### User
- `GET /api/auth/user` - Get current user profile
- `PATCH /api/auth/user` - Update user profile

## Error Handling

All API errors follow this format:

```json
{
  "message": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {}  // Optional additional details
}
```

### HTTP Status Codes

| Status | Description |
|--------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Invalid/expired token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found |
| 429 | Too Many Requests - Rate limited |
| 500 | Server Error |

## Security Best Practices

1. **Store tokens securely**: Use iOS Keychain or Android Keystore
2. **Refresh proactively**: Refresh tokens before they expire
3. **Handle logout**: Delete stored tokens on logout
4. **Use HTTPS**: All API requests must use HTTPS
5. **Validate deep links**: Verify the source of deep link callbacks

## Security Features

The mobile authentication implementation includes several security measures:

1. **Signature Verification on Refresh**: Token refresh always verifies the JWT signature, even for expired tokens. This prevents forged tokens from being refreshed into valid ones.

2. **Scheme Whitelisting**: Only whitelisted URL schemes (`grammix`, `grammix-dev`, `grammix-staging`) are accepted for deep link callbacks, preventing open redirect attacks.

3. **Grace Period Limits**: Expired tokens can only be refreshed within a 7-day window. Beyond that, re-authentication is required.

4. **Production Secret Enforcement**: The server will fail to start if `SESSION_SECRET` is not configured in production, preventing use of default secrets.

## iOS Implementation Notes

### Deep Link Configuration

Add to `Info.plist`:
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>grammix</string>
    </array>
  </dict>
</array>
```

### Handle Auth Callback

```swift
func application(_ app: UIApplication, 
                 open url: URL,
                 options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    if url.scheme == "grammix" && url.host == "auth" {
        if let token = url.queryParameters["token"] {
            // Store token and proceed
            KeychainManager.shared.storeToken(token)
            NotificationCenter.default.post(name: .authSuccess, object: nil)
        } else if let error = url.queryParameters["error"] {
            // Handle error
            NotificationCenter.default.post(name: .authError, object: error)
        }
        return true
    }
    return false
}
```

## Android Implementation Notes

### Deep Link Configuration

Add to `AndroidManifest.xml`:
```xml
<activity android:name=".AuthActivity">
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="grammix" android:host="auth" />
    </intent-filter>
</activity>
```

### Handle Auth Callback

```kotlin
class AuthActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        intent?.data?.let { uri ->
            when {
                uri.getQueryParameter("token") != null -> {
                    val token = uri.getQueryParameter("token")!!
                    TokenManager.saveToken(token)
                    navigateToHome()
                }
                uri.getQueryParameter("error") != null -> {
                    val error = uri.getQueryParameter("error")!!
                    showError(error)
                }
            }
        }
    }
}
```

## Testing

Test the mobile auth flow:

1. **Get auth URL**: Open `/api/auth/mobile/login?scheme=grammix` in browser
2. **Complete OAuth**: Authenticate with Replit
3. **Capture callback**: Note the `token` parameter in the redirect
4. **Test token**: Use the token in Authorization header

```bash
# Test token status
curl -H "Authorization: Bearer <token>" \
  https://your-app.replit.app/api/auth/mobile/status

# Test token refresh
curl -X POST -H "Authorization: Bearer <token>" \
  https://your-app.replit.app/api/auth/mobile/refresh

# Test authenticated API call
curl -H "Authorization: Bearer <token>" \
  https://your-app.replit.app/api/recipes
```

## Changelog

- **v1.0** (2026-01-31): Initial JWT authentication implementation
  - OAuth login with deep link callback
  - Token refresh with 7-day grace period
  - Dual-auth middleware for all API routes
  - 30-day token expiration with refresh hints
