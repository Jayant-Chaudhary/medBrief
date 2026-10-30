# Windows Startup Guide: Running the App on Physical Phone via USB

This guide contains the exact Windows PowerShell commands needed to start all backend services and run the mobile Flutter app on a real Android phone via USB debugging.

---

## Step 0: Ensure `mobile/config.json` is set to Localhost

Open `mobile/config.json` and verify `API_BASE_URL` points to `127.0.0.1:4000`:

```json
{
  "SUPABASE_URL": "https://bgvnqpjxhflsjuebqvdr.supabase.co",
  "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_QTXvGbJOaEivta3Tv99v5A_aRnPno7f",
  "API_BASE_URL": "http://127.0.0.1:4000"
}
```
*(Note: Use `http://10.0.2.2:4000` only if testing on the Android Emulator, and `http://127.0.0.1:4000` for physical phone USB debugging).*

---

## Step 1: ADB Port Forwarding (Terminal / Setup)

Make sure your phone is connected via USB, **USB Debugging** is turned ON, and the phone is connected to Wi-Fi/Mobile Data (needed for Supabase).

1. Check attached devices:
   ```powershell
   adb devices
   ```

2. Forward port `4000` to the phone over USB:
   - **If only your phone is connected:**
     ```powershell
     adb reverse tcp:4000 tcp:4000
     ```
   - **If both phone and emulator are active** (specify device ID):
     ```powershell
     adb -s ZA2232GKKP reverse tcp:4000 tcp:4000
     ```

3. Verify it is active:
   ```powershell
   adb -s ZA2232GKKP reverse --list
   ```
   *(Should show: `(reverse) tcp:4000 tcp:4000`)*

---

## Backend Services (Terminals 1 to 4)

Open 4 separate PowerShell terminals:

### Terminal 1 — Identity Service
```powershell
cd D:\Projects\health-on-project\server
node --env-file="D:\Projects\tempo\medbrief-private\identity.env" src/community/identity-service.js
```

### Terminal 2 — Safety Service
```powershell
cd D:\Projects\health-on-project\server
$env:NODE_ENV="development"; $env:COMMUNITY_LLM_BYPASS="true"; node --env-file="D:\Projects\tempo\medbrief-private\saftey.env" src/community/safety-service.js
```

### Terminal 3 — Main Express API Server
```powershell
cd D:\Projects\health-on-project\server
npm run dev
```

### Terminal 4 — Background Jobs Worker
```powershell
cd D:\Projects\health-on-project\server
while ($true) { node --env-file="D:\Projects\tempo\medbrief-private\jobs.env" src/community/worker.js; Start-Sleep -Seconds 10 }
```

---

## Step 2: Flutter App (Terminal 5)

Open a 5th PowerShell terminal:

```powershell
cd D:\Projects\health-on-project\mobile
flutter run -d ZA2232GKKP --dart-define-from-file=config.json
```
*(Or simply `flutter run --dart-define-from-file=config.json` if the emulator is closed).*

---

## Quick Troubleshooting Checklist
- **"Check your internet connection and try again"**:
  1. Phone must have Wi-Fi or mobile data turned on (for Supabase).
  2. Run `adb -s ZA2232GKKP reverse tcp:4000 tcp:4000` again (if the cable was unplugged).
  3. Confirm `mobile/config.json` uses `"http://127.0.0.1:4000"`.
- **"error: more than one device/emulator"**:
  Always pass `-s <DEVICE_ID>` (e.g. `-s ZA2232GKKP`) or close the Android Emulator.

