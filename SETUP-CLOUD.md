# Cloud setup (save bills online)

This is the **automatic backup** of the app. Nothing has to be installed on the shop
computer: the app is a live web address, and every new bill is saved online (Google
Firebase) the moment it is saved. If the browser is cleared or the PC is lost, nothing is
lost, and the same bills can be opened from any other computer or phone.

(A web page cannot write files to the PC by itself, so the online copy is what makes the
backup automatic. The **Download backup** button stays as an extra manual copy.)

Until you finish these steps the app still works (bills stay in the browser only), but
it is **not** backed up automatically. The free Firebase plan is plenty for one shop.

You need: a Google account, internet, and about 20 minutes.

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with the Google account.
2. **Create a project** (or **Add project**) -> name it, e.g. `shree-narayani-billing`.
3. Google Analytics: switch it **off** -> **Create project**.

## 2. Create the database

1. Left menu: **Build -> Firestore Database -> Create database**.
2. Location: **asia-south1 (Mumbai)** (closest to Kolhapur). You cannot change this later.
3. Choose **Start in production mode** -> **Create**.

## 3. Create the shop login

1. Left menu: **Build -> Authentication -> Get started**.
2. **Sign-in method** tab -> **Email/Password** -> turn **Enable** on -> **Save**.
3. **Users** tab -> **Add user** -> enter the shop's email and a strong password.
   Keep these safe. This is the login used inside the app (all shop computers/phones
   can use the same one).

## 4. Get the app settings and paste them in

1. Click the gear icon -> **Project settings** -> **General** -> scroll to **Your apps**.
2. Click the web icon **`</>`** -> give it a nickname -> **Register app**
   (do not tick "Firebase Hosting" here).
3. You will see a block called `firebaseConfig`. Copy the four values
   `apiKey`, `authDomain`, `projectId`, `appId` into **`firebase-config.js`** in this folder:

   ```js
   window.SN_FIREBASE = {
     apiKey: 'AIza...',
     authDomain: 'your-project.firebaseapp.com',
     projectId: 'your-project',
     appId: '1:123456789:web:abcdef'
   };
   ```

   (These are not secrets. The rules in the next step are what protect the data.)

## 5. Publish the security rules

1. **Firestore Database -> Rules** tab.
2. Delete what is there, paste the full contents of **`firestore.rules`** from this folder.
3. Click **Publish**.

This makes sure only the signed-in shop login can read or write the bills.

## 6. Put the app online (so it opens on any computer / phone)

Firebase Hosting gives the app a web address (free). Do this on **your** computer (the
one you build on) - the shop computer needs nothing installed, it just opens the address:

1. Install Node.js from <https://nodejs.org> (LTS version) if it is not installed.
2. Open a terminal (PowerShell) in this folder and run:

   ```
   npm install -g firebase-tools
   firebase login
   firebase use --add
   firebase deploy --only hosting,firestore:rules
   ```

   - `firebase login` opens a browser to sign in with the same Google account.
   - `firebase use --add` -> pick the project you created -> give it the alias `default`.
3. The last command prints a **Hosting URL**, like `https://your-project.web.app`.
   Open it on the shop computer and on the phone. Bookmark it / "Add to home screen".

Whenever you change any file here, run `firebase deploy --only hosting` again.

> Opening `index.html` directly from the folder can also work, but the web address
> above is the reliable way and works on every device.

**Using another host or your own domain** (Netlify, GitHub Pages, `www.yourshop.com`)?
That works too - upload all the files in this folder (except the `.md` files and
`firebase.json`/`firestore.rules`). Then tell Firebase the address is allowed:
**Authentication -> Settings -> Authorized domains -> Add domain** and add it. Without
this, signing in is refused. (Firebase Hosting addresses are allowed automatically.)

## 7. Sign in inside the app

1. Open the app. Top right there is a small button: **Sign in to sync**. A red banner on
   the dashboard also says **Automatic online backup is OFF** until you do.
2. Click it -> enter the shop login from step 3 -> **Sign in**.
3. The button turns green: **Synced**. All bills already on that computer are uploaded
   the first time.

On every other computer or phone: open the web address, sign in once, and the bills
appear. Do this once per computer/browser; it stays signed in afterwards.

---

## How it behaves

- **No internet?** You can keep making bills. They are kept on the computer and upload
  automatically when the internet is back (the pill shows `Offline - N waiting`).
- **Two computers at once:** a bill saved on one appears on the other within seconds.
  If the same invoice is edited on both, the most recent save wins.
- **Invoice numbers:** numbers continue from the highest one in the cloud. If two
  computers are both **offline** and both make a bill, they could pick the same number.
  Keep the computers online while billing, or give each computer its own prefix.
- **Deleting a bill** deletes it on every computer.
- **Sign out** keeps the bills on that computer; sign in again to continue syncing.
- **Browser data cleared / new computer:** open the address and sign in again. All bills
  come back automatically (this also signs you out, so you must sign in once more).
- **A bill saved while signed out** is only on that computer. The app warns about it when
  saving ("saved on this computer only") and uploads it as soon as you sign in. So make
  sure every computer is signed in - the dashboard banner tells you if it is not.

## Is it safe? Do these 4 things

Firebase is run by Google; data is encrypted in transit and at rest. What decides
whether *your* data is safe is how it is set up:

1. **Publish the rules (step 5).** Without them the database is not protected.
   Test them once: Firestore -> Rules -> **Rules playground**, pick `get`, path
   `/shops/anything/bills/test`, leave "Authenticated" **off** -> it must say *Denied*.
2. **Protect the Google account** that owns the project: turn on 2-step verification
   (<https://myaccount.google.com/security>). Whoever controls that account controls the data.
3. **Use a strong password** for the shop login and do not share it outside the shop.
   If a worker leaves, change it (Firebase -> Authentication -> Users -> the user -> Reset password).
4. **Stop strangers creating accounts:** Authentication -> **Settings** -> **User actions**
   -> turn off **Enable create (sign-up)** (if you see the option). Strangers could never read
   your bills anyway, because of the rules, but this keeps the user list clean.

The `apiKey` in `firebase-config.js` is not a password. Every Firebase web app shows it
publicly; the rules and the login are what keep the data private.

## Still keep backups

Cloud sync protects against a lost PC. It does not protect against a bill deleted by
mistake (the delete syncs too). So the app also saves a **backup file to the Downloads
folder by itself** each time a new bill is saved (setting: "Backup file by itself" in
dashboard -> Backup & Restore: after every new bill / once a day / off). Files are named
with the date and time and pile up - keep the newest few, delete the rest now and then,
and copy one to Google Drive or a pen drive once in a while. The **Download backup**
button does the same by hand.

## Troubleshooting

| Pill says | What to do |
|---|---|
| **Cloud: not set up** | `firebase-config.js` is empty - do step 4. |
| **Sign in to sync** | Click it and sign in (step 7). |
| **Sync problem** | The rules were not published or are wrong - redo step 5. |
| **Offline** | No internet. Bills are safe and will upload later. |
| "Wrong email or password" | Check the user in Firebase -> Authentication -> Users. Use "Forgot password?". |

## Cost

The free (Spark) plan allows 1 GB of data and 20,000 writes / 50,000 reads per day. One
bill is one write. A shop would use a tiny fraction of that.
