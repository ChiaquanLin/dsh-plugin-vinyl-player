# Publishing this repository

The repository is already initialised and committed. Two steps remain: create the
empty repository on GitHub, then push to it.

## 1. Create the repository

Create an **empty** repository 鈥?no README, no `.gitignore`, no licence file. This
project already has all three, and an initialised remote will conflict on the first
push.

- Owner: `ChiaquanLin`
- Name: `dsh-plugin-vinyl-player`
- Visibility: public
- Do **not** tick "Add a README file"

## 2. Push

```bash
cd E:/dsh/vinyl-room
git remote add origin https://github.com/ChiaquanLin/dsh-plugin-vinyl-player.git
git push -u origin main
```

If Git asks for credentials, use a personal access token as the password
(Settings 鈫?Developer settings 鈫?Personal access tokens 鈫?Fine-grained tokens),
scoped to this one repository with **Contents: read and write**.

## 3. Set the repository topics

Topics are what make the plugin discoverable: `dsh-plugin` is the topic the
Harness ecosystem is searched by, and it **must** be present.

```bash
gh repo edit ChiaquanLin/dsh-plugin-vinyl-player --add-topic dsh-plugin
```

Or set them in the browser under the repository's gear icon next to "About":

```
dsh-plugin
dsh
deepseek-harness
cordis
cordis-plugin
bilibili
music
vinyl
turntable
audio-player
web-ui
```

The same list appears in `package.json` under `keywords`, which is what npm reads.
Keep the two in sync: the first keyword there is `dsh-plugin` for the same reason.

## 4. Check the result

- The README renders, and the deck diagram at the top shows an image rather than a
  broken link.
- The **dsh-plugin** topic appears under the description.
- The `test` workflow runs and passes on the first push. It needs no secrets: the
  static suites render components with a stub React and touch no network.

## Notes

- `tools/deck-preview.svg` is committed on purpose 鈥?it is the README image. The
  test suites overwrite it when they run, so re-commit it if the deck changes.
- The licence is MIT, and the disclaimer in the README is deliberately prominent.
  Do not remove it: the plugin reads from endpoints it does not own, and that notice
  is what tells a reader what they are taking on.
