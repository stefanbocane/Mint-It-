# Supabase Storage Setup for Card Images

## Overview
This guide sets up Supabase Storage to replace Firebase Storage for card images.

## Step 1: Create Storage Bucket

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project

2. **Navigate to Storage**
   - Click "Storage" in the left sidebar
   - Click "New bucket"

3. **Create `cards` Bucket**
   - **Name**: `cards`
   - **Public bucket**: ✅ **YES** (images need to be publicly accessible)
   - **File size limit**: 5 MB (recommended for card images)
   - **Allowed MIME types**: `image/jpeg, image/png, image/jpg`
   - Click "Create bucket"

## Step 2: Set Up Storage Policies

The bucket needs RLS policies to control access:

### Policy 1: Allow Authenticated Users to Upload
```sql
-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'cards' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

### Policy 2: Public Read Access
```sql
-- Anyone can view card images
CREATE POLICY "Public read access"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'cards');
```

### Policy 3: Users Can Update Own Files
```sql
-- Users can update their own images
CREATE POLICY "Users can update own files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'cards' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

### Policy 4: Users Can Delete Own Files
```sql
-- Users can delete their own images
CREATE POLICY "Users can delete own files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'cards' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

## Step 3: Apply Policies via Dashboard

1. **Go to Storage → Policies**
2. **Select the `cards` bucket**
3. **Click "New Policy"**
4. **For each policy above**:
   - Choose the operation (INSERT, SELECT, UPDATE, DELETE)
   - Select "Custom" policy
   - Paste the SQL from above
   - Click "Review" then "Save"

## Step 4: Update App Code

### Install Required Dependency

```bash
npm install expo-file-system
```

### Switch to Supabase Version

Edit `src/navigation/TabNavigator.js` (or wherever CoinScreen is imported):

```javascript
// Before:
import CoinScreen from '../screens/CoinScreen';

// After:
import CoinScreen from '../screens/CoinScreenSupabase';
```

## Step 5: Verify Storage Setup

### Test Upload Manually

1. Go to Storage → `cards` bucket
2. Click "Upload file"
3. Try uploading a test image
4. Verify it appears in the bucket
5. Try accessing the public URL

### Test Via App

1. Login to the app
2. Go to Coin Screen
3. Take/select a photo
4. Enter card name
5. Click "Coin Card"
6. Should succeed without "unauthorized" error

## Storage Structure

Files will be organized as:
```
cards/
  ├── {user_id_1}/
  │   ├── 1234567890_abc123.jpg
  │   └── 1234567891_def456.jpg
  ├── {user_id_2}/
  │   └── 1234567892_ghi789.jpg
  ...
```

## Key Differences from Firebase Storage

| Feature | Firebase Storage | Supabase Storage |
|---------|-----------------|------------------|
| **Upload API** | `uploadBytes(ref, blob)` | `upload(path, arrayBuffer)` |
| **URL Access** | `getDownloadURL(ref)` | `getPublicUrl(path)` |
| **Authentication** | Firebase Auth rules | Supabase RLS policies |
| **Encoding** | Direct blob | Base64 → ArrayBuffer |
| **Path Format** | `gs://bucket/path` | `cards/user_id/file.jpg` |

## Troubleshooting

### Error: "new row violates row-level security policy"
**Solution**: Make sure policies are created and enabled for the bucket.

### Error: "Bucket not found"
**Solution**: Verify bucket name is exactly `cards` (case-sensitive).

### Error: "Public URL returns 404"
**Solution**:
1. Ensure bucket is marked as **Public**
2. Check SELECT policy allows public access

### Error: "Failed to upload"
**Solution**:
1. Check file size < 5 MB
2. Verify MIME type is allowed
3. Ensure user is authenticated
4. Check INSERT policy allows uploads

### Error: "Permission denied"
**Solution**: User might not have a profile in `users` table. Deploy `supabase/09-user-profile-init.sql` first.

## Migration Checklist

- [ ] Create `cards` bucket in Supabase Storage
- [ ] Set bucket to Public
- [ ] Create all 4 RLS policies
- [ ] Install `expo-file-system` package
- [ ] Update import in TabNavigator.js
- [ ] Test card coining in app
- [ ] Verify images appear in Supabase Storage
- [ ] Verify public URLs work

## Next Steps

Once card storage is working:
1. Migrate card retrieval/display to Supabase
2. Migrate auction system to Supabase
3. Migrate collection screen to Supabase
4. Remove Firebase Storage entirely
