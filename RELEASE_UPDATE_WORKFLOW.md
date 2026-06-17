# Release And Update Workflow

Tai lieu nay ghi lai quy tac phat hanh va cap nhat cho app desktop nay, de sau nay co the dua cho AI khac doc va thao tac dung quy trinh.

## Muc tieu

- Nguoi dung chi can `install` app mot lan.
- Cac lan cap nhat ve sau duoc lay qua `Check updates` trong app.
- Nguon cap nhat la `GitHub Releases`, khong phai source code tren branch.

## Repo dang su dung

- GitHub repo: `https://github.com/onesv-arch/Chrome_Profile`
- Update config hien tai nam trong [app-update-config.json](c:\Users\Admin\Documents\Clone_Chrome_Profile\app-update-config.json:1)

## Nguyen tac quan trong

1. `Push code len branch` thi chua du de nguoi dung update.
2. App updater chi doc tu `GitHub Releases`.
3. Muon co ban cap nhat moi, phai:
   - tang `version` trong `package.json`
   - commit code
   - tao tag theo dang `vX.Y.Z`
   - push tag len GitHub
4. GitHub Actions se build va publish release assets.
5. Sau do nguoi dung mo app va bam `Check updates`.

## Khong duoc nham lan

- `git push origin main`:
  - chi day source code len GitHub
  - khong tao release moi cho updater

- `git push origin v0.1.1`:
  - day tag release
  - workflow release moi chay
  - updater moi thay ban moi

## Quy trinh release chuan

### 1. Sua code

Lam thay doi can thiet trong project.

### 2. Tang version

Sua `version` trong [package.json](c:\Users\Admin\Documents\Clone_Chrome_Profile\package.json:1)

Vi du:

- `0.1.0` -> `0.1.1`
- `0.1.1` -> `0.2.0`

Khong duoc release lai cung mot version voi noi dung khac.

### 3. Test va build local

```powershell
node --test
npm.cmd run dist
```

Kiem tra:

- app build duoc
- installer tao ra binh thuong
- neu can, mo app va thu `Check updates`

### 4. Commit thay doi

```powershell
git add .
git commit -m "Your release message"
git push origin main
```

### 5. Tao tag release

Tag phai theo dang `vX.Y.Z`

Vi du:

```powershell
git tag v0.1.1
git push origin v0.1.1
```

### 6. GitHub Actions tu dong publish

Workflow nam o:

- [.github/workflows/release.yml](c:\Users\Admin\Documents\Clone_Chrome_Profile\.github\workflows\release.yml:1)

Khi tag duoc push:

- GitHub Actions build Windows installer
- publish len `GitHub Releases`
- tao cac file updater can dung

## Cac file release quan trong

Moi release can co cac artifact sau tren GitHub Releases:

- `Chrome Profile Cloner-Setup-x.y.z.exe`
- `latest.yml`
- `*.blockmap`

Day la cac file updater can de:

- check version moi
- download ban moi
- cai update

## Nguoi dung update nhu the nao

Sau khi da co release moi tren GitHub Releases:

1. Nguoi dung mo app da cai truoc do
2. Bam `Check updates`
3. App se check tren GitHub Releases
4. Neu co ban moi:
   - bam `Download`
   - sau khi tai xong, bam `Install`

## Dieu kien de updater hoat dong

Phai dam bao:

- `app-update-config.json` dung owner/repo
- release duoc publish len `GitHub Releases`
- version moi cao hon version dang cai
- app khong dang clone profile trong luc update

## Quy tac version

Nen dung:

- patch: `0.1.0` -> `0.1.1`
- minor: `0.1.1` -> `0.2.0`
- major: `0.2.0` -> `1.0.0`

Neu ban da tung tao `v0.1.0`, lan sau hay tao `v0.1.1` hoac cao hon.

Khong sua noi dung release cu roi giu nguyen version.

## Neu can release thu cong bang may local

Can co `GH_TOKEN`:

```powershell
$env:GH_TOKEN="your_github_token"
npm.cmd run publish:github
```

Nhung voi project nay, uu tien workflow tu dong qua GitHub Actions sau khi push tag.

## Checklist ngan truoc moi lan release

- da sua code xong
- da tang `version`
- `node --test` pass
- `npm.cmd run dist` pass
- da commit
- da push `main`
- da tao va push tag `vX.Y.Z`
- da kiem tra release tren GitHub

## Cau lenh mau cho lan release tiep theo

Vi du release `0.1.1`:

```powershell
node --test
npm.cmd run dist
git add .
git commit -m "Release 0.1.1"
git push origin main
git tag v0.1.1
git push origin v0.1.1
```

## Tom tat 1 dong

`Push source code` khong tao update cho nguoi dung; `push tag release` moi tao update de app keo tu `GitHub Releases`.
