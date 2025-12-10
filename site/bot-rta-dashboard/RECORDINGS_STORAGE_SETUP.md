# Recordings Storage Setup Guide for Render

## Option 1: Render Disk (Recommended - Simplest)

### Steps:
1. In Render Dashboard, go to your **Web Service**
2. Click **"Disks"** tab (in the left sidebar)
3. Click **"Add Disk"** button
4. Configure:
   - **Name**: `recordings` (or any name)
   - **Size**: 10GB (or more, ~100MB per recording)
   - **Mount Path**: `/opt/render/project/src/recordings`
5. Click **"Add Disk"** to create

### Environment Variable:
Add this to your Render Web Service environment variables:
```bash
RECORDINGS_DIR=/opt/render/project/src/recordings
```

**Note**: The mount path must match what you set in Render Disk configuration.

### Pros:
- ✅ Simple setup (5 minutes)
- ✅ No external dependencies
- ✅ Works immediately after deploy
- ✅ Persistent across deployments

### Cons:
- ❌ Costs extra (~$0.25/GB/month)
- ❌ Limited scalability (need to manually increase size)

### Testing:
After adding the disk and environment variable:
1. Redeploy your service
2. Start a test recording
3. Check Render logs - should see file saved to `/opt/render/project/src/recordings`
4. Files persist even if service restarts

---

## Option 2: Cloudflare R2 (Advanced - Free Tier Available)

### Steps:
1. Create Cloudflare account
2. Go to R2 → Create bucket
3. Create API token with R2 permissions
4. Get endpoint URL (format: `https://<account-id>.r2.cloudflarestorage.com`)

### Environment Variables (in Render):
```bash
RECORDINGS_STORAGE_TYPE=cloud
RECORDINGS_BUCKET=your-bucket-name
RECORDINGS_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
RECORDINGS_ACCESS_KEY_ID=your-access-key
RECORDINGS_SECRET_ACCESS_KEY=your-secret-key
RECORDINGS_REGION=auto
```

### Pros:
- ✅ Free tier: 10GB storage + 1M operations/month
- ✅ No egress fees (unlike S3)
- ✅ S3-compatible API
- ✅ Scalable
- ✅ Persistent across deployments

### Cons:
- ❌ Requires external account setup

---

## Option 3: AWS S3

### Environment Variables:
```bash
RECORDINGS_STORAGE_TYPE=cloud
RECORDINGS_BUCKET=your-bucket-name
RECORDINGS_ACCESS_KEY_ID=your-access-key
RECORDINGS_SECRET_ACCESS_KEY=your-secret-key
RECORDINGS_REGION=us-east-1
# RECORDINGS_ENDPOINT not needed (uses default S3)
```

### Pros:
- ✅ Industry standard
- ✅ Very reliable
- ✅ Good free tier (5GB for 12 months)

### Cons:
- ❌ Egress fees
- ❌ More complex pricing

---

## Current Implementation

- **Default**: Local disk (`recordings/` folder in project root)
- **With RECORDINGS_DIR env var**: Uses specified directory (e.g., Render Disk)
- **Metadata**: Stored in-memory (will be moved to Redis in future update)

## Quick Start (Render Disk)

1. Add Render Disk (10GB recommended)
2. Set mount path: `/opt/render/project/src/recordings`
3. Add environment variable: `RECORDINGS_DIR=/opt/render/project/src/recordings`
4. Redeploy service
5. Done! Recordings will persist across deployments

## Testing

After setup:
1. Start a recording from dashboard (2 minutes test)
2. Check Render logs - should see: `[Recordings] Uploaded recording...`
3. Verify file exists in disk (via Render shell or logs)
4. Try downloading from dashboard recordings list
5. Restart service - recordings should still be available

