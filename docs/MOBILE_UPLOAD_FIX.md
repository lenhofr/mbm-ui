# Mobile Image Upload Fix

## Problem
When users tried to upload images from mobile devices (specifically iPhone), the images would not display after being uploaded to the recipe.

## Root Cause
The image upload code was missing the `Content-Type` header when uploading files to S3 via the presigned URL. Without this header, S3 stores files with a generic content type (`binary/octet-stream` or similar) instead of the proper MIME type (e.g., `image/jpeg`, `image/png`).

When mobile browsers (especially Safari on iOS) try to display images with incorrect content types, they may fail to render them properly.

## Solution
Added the `Content-Type` header to the S3 PUT request, using the file's MIME type from the `File` object's `type` property.

### Changed Code
**File:** `src/components/DetailsModal.tsx` (line 181)

**Before:**
```typescript
await fetch(data.uploadUrl, { method: 'PUT', body: imageFile })
```

**After:**
```typescript
await fetch(data.uploadUrl, { method: 'PUT', body: imageFile, headers: { 'Content-Type': imageFile.type } })
```

## Technical Details

### How it works
1. When a user selects an image file using the `<input type="file">` element, the browser creates a `File` object
2. The `File` object has a `type` property that contains the MIME type (e.g., "image/jpeg", "image/png", "image/gif")
3. When uploading to S3, this MIME type is now sent in the `Content-Type` header
4. S3 stores the object with this content type
5. When the image is later retrieved, S3 serves it with the correct `Content-Type` header
6. Browsers can now properly display the image

### Why this fixes mobile uploads
Mobile browsers (especially iOS Safari) are more strict about MIME types than desktop browsers. Without the correct content type, iOS Safari may refuse to display the image or render it incorrectly. By ensuring S3 stores and serves images with the correct content type, mobile browsers can properly display them.

## Testing
- ✅ Build successful - no TypeScript errors
- ✅ No security vulnerabilities introduced (CodeQL scan passed)
- ✅ Existing tests still pass
- ✅ Minimal change - only one line modified

## Impact
This is a minimal, surgical fix that:
- Does not change any API contracts
- Does not affect existing functionality
- Follows web standards and best practices for file uploads
- Fixes image display issues on mobile devices (particularly iPhone)
