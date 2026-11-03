# Profile photos (JoyoRogo account)

Written 2026-10-18. JoyoFit shows the JoyoRogo profile photo of every person in Social and of the signed-in account in Settings, and lets the signed-in person set or remove their own photo.

## Why no photos showed

JoyoRogo serves `user.image` in one of two shapes:

| Shape | Who has it | Example |
| --- | --- | --- |
| Absolute Google photo URL | 90 of 103 accounts, the owner's included | `https://lh3.googleusercontent.com/...=s96-c` |
| Server-relative path of an uploaded photo | whoever uploaded one | `/avatar/<userId>/<32 hex>.jpg` |

Both answer 200 without cookies (the `/avatar/...` route is public, immutable, cached for a year), so the images were never the problem. Three things were:

1. `Avatar` (`src/components/Avatar.tsx`, commit 68dd4b3, 2026-10-18 00:05) is what renders both shapes, with an initials fallback. The newest installed builds were made on 2026-10-17, before that commit: photos ship with the next build.
2. The Settings hub summary card never drew a photo: it printed the first letter of the email in a colored circle.
3. JoyoFit had no way to set a photo, so an account without a Google photo showed initials forever.

## What changed

- **Social surfaces, checked, no change needed.** Each passes the field the server fills: `PostCard` `post.author.image` (`social.feed`, `social.post`, `social.myPosts`, `social.publicProfile` posts), `CommentsSection` `comment.author.image` (`social.comments`), `MemberRow` `member.image` (`group.detail`), `ProfileHeader` `image` from `u/[handle]` `profile.image` (`social.publicProfile`) and from the own profile `authClient.useSession().data.user.image`. The groups list shows groups, not people. An empty name shows `?`.
- **`Avatar`** has a fourth size, `xl` (56).
- **Settings hub summary card** (`src/app/settings/index.tsx`) draws `Avatar` `xl` for a signed-in account: the account's photo, else the initials of the account name, else the first letter of the email. Decorative; the row's label is still the email and the status line.
- **Settings > Akun** (`src/app/settings/akun.tsx`) starts with `ProfilePhoto` (`src/features/settings/ProfilePhoto.tsx`): `Avatar` `xl`, name, email, "Change photo" and, only for an uploaded photo, "Remove photo". A success toast confirms.
- **`rogo.avatar.upload` / `rogo.avatar.remove`** (`src/cloud/rogo.ts`) call the existing oRPC procedures `avatar/upload` and `avatar/remove`. Nothing changed in JoyoRogo.
- **`src/cloud/avatar.ts`** (no React Native imports; `avatar.test.ts`): `cropSquare`, `avatarUploadInput`, `isUploadedAvatar`, `isPermissionError`, and the constants `AVATAR_SIDE` (512) and `AVATAR_QUALITY` (0.85). `src/features/settings/pickAvatar.ts` is the part that touches the picker and the manipulator.
- Copy is in `settings.account.photo.*` (id and en).

## Setting a photo

1. "Change photo" opens a notice that says why and what happens ("Pilih foto dari galeri ... terlihat oleh orang lain di feed dan grup"); its one button, "Lanjut", always opens the gallery (`NoticeDialog`: no Cancel and no scrim or Back exit, Apple 5.1.1(iv)). Nothing is sent until a photo is picked, and the system gallery has its own Cancel.
2. `ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, exif: false })`. The system crop screen gives the square. Gallery only, no camera.
3. `pickAvatar` center-crops to a square anyway (`cropSquare`), resizes to 512 x 512 and renders a JPEG at 0.85 with base64, exactly like `apps/native/app/profil/akun.tsx` in JoyoRogo. Backing out at any step does nothing and shows nothing.
4. `avatar.upload({ imageBase64, mimeType: 'image/jpeg' })` through `rogoCall` (the session cookie of better-auth's expo client, `credentials: 'omit'`).
5. The session is read again with `refetch({ query: { disableCookieCache: true } })`. JoyoRogo turns on better-auth's cookie cache (5 minutes), so a plain refetch would keep answering with the old photo; skipping the cache makes the hub, the Social profile and everything else that reads `useSession()` update at once.

Failures stay on screen as a `Notice`: the photo could not be prepared, the upload failed (the server's message), or the removal failed. The buttons are disabled and the pressed one spins while a request runs.

## Removing a photo

`avatar.remove` only acts on an uploaded photo: it deletes the object and sets `user.image` back to the Google photo that the upload remembered (`customMetadata.g`), or to `null` when there was none. For an account whose image is a Google URL it returns the same image and changes nothing, so JoyoFit shows "Remove photo" only when `isUploadedAvatar(user.image)` (the pattern of `customAvatarKey` on the server). JoyoRogo's own app offers it for any image; that button is a no-op for Google photos.

## How the photo is stored

R2 bucket `STICKERS`, key `avatars/<userId>/<id>.<ext>`, with the previous Google photo in the object's `customMetadata.g`. `user.image` holds the public path `/avatar/<userId>/<id>.<ext>`, which `apps/server` serves without a session (`Cache-Control: public, max-age=31536000, immutable`). Every upload mints a new id and deletes the previous object, so the URL never changes content and clients can cache it forever. JoyoFit resolves the path against `JOYOROGO_URL` (`avatarUri`).

## JS only

No native change. `expo-image-picker` and `expo-image-manipulator` have been dependencies since e27f9d8 (2026-10-15), and the picker is already used for gear photos, stickers and the watch face.

Permission: the system gallery needs no permission to pick (Android's photo picker, iOS's out-of-process picker); `expo-image-picker` asks for one only to open the camera. So the "Allow access, then open settings" notice (`isPermissionError`, `Linking.openSettings()`) is a safeguard and is not expected to appear. The `expo-image-picker` plugin in `app.json` already writes `NSPhotoLibraryUsageDescription` (its `photosPermission`). That text names the watch face and the workout image, not the profile photo; widening it would need a native build, so it was left as it is.

## Tests

`bun test ./src/cloud/avatar.test.ts`: crop geometry (landscape, portrait, square, odd and fractional sizes, unusable sizes), the upload body, which images count as uploaded, and what a permission refusal looks like.
