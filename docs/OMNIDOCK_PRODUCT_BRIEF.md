# OmniDock Product And Documentation Brief

Bu dosya, OmniDock icin web sitesi, dokumantasyon, landing page, GitHub Pages icerigi, README genisletmesi, urun tanitimi, kurulum rehberi ve SEO metinleri hazirlayacak baska bir sohbet veya ajan icin kaynak metindir.

Metin bilincli olarak detaylidir. Web sitesi olustururken buradaki bolumler birebir kullanilabilir, kisaltilabilir veya docs sayfalarina ayrilabilir.

## 1. Urun Kimligi

Urun adi: **OmniDock**

Kisa tanim:

OmniDock, Cloudflare Workers uzerinde calisan acik kaynakli, self-hosted email operasyon panelidir. Cloudflare Email Routing, Email Sending, D1, R2, Gmail/external IMAP-SMTP hesaplari, kontaklar, imzalar, loglar, R2 dosya yonetimi, preview, upload ve OCR-ready text index ozelliklerini tek bir Linux tarzi dashboard icinde toplar.

Tek cumlelik pitch:

**OmniDock, Cloudflare uzerindeki email, domain routing, harici inbox sync ve R2 dosya operasyonlarini tek bir self-hosted panelde birlestirir.**

Uzun pitch:

OmniDock, kendi Cloudflare hesabini kullanan ekipler icin gelistirilmis acik kaynakli bir email operasyon merkezidir. Cloudflare Email Routing ile gelen mailleri Worker uzerinden alir, D1 icinde mesaj ve thread metadata'sini tutar, R2 icinde raw mail, attachment ve manuel dosyalari saklar. Cloudflare Email Sending veya harici SMTP hesaplari ile email gonderir. Gmail, Outlook, Yahoo, iCloud veya custom IMAP/SMTP hesaplari metadata olarak eklenebilir; credential degerleri D1'e veya repoya yazilmaz, Cloudflare Worker secrets icinde kalir.

OmniDock bir SaaS degildir. Kullanicinin kendi fork'u, kendi Cloudflare Worker'i, kendi D1 veritabani, kendi R2 bucket'i ve kendi secret'lari ile calisir. Amac, ozellikle cok domainli ekiplerin destek emaili, routing, catch-all, attachment, bucket, external inbox ve audit operasyonlarini tek bir guvenli ve kompakt arayuzden yonetmesidir.

## 2. Konumlandirma

OmniDock su sekilde konumlandirilmalidir:

- Self-hosted Cloudflare email dashboard
- Cloudflare-native support inbox
- Cloudflare Workers email operations panel
- Multi-domain Email Routing ve Email Sending admin UI
- R2 bucket manager ve email attachment manager
- Gmail/external IMAP-SMTP sync paneli
- D1 tabanli private email operations database
- Linux tarzi, desktop verimliligine odaklanan operasyon arayuzu

OmniDock su sekilde anlatilmamalidir:

- Tam bir Gmail alternatifi degildir.
- Hosted mailbox provider degildir.
- IMAP/POP3 server degildir.
- Herkes icin hazir SaaS inbox degildir.
- Otomatik ve maliyetli AI OCR sistemi degildir.
- Cloudflare yerine gecen bir panel degildir; Cloudflare kaynaklarini yonetmek icin ona baglanir.

## 3. Hedef Kitle

OmniDock asagidaki kullanicilar icin uygundur:

- Cloudflare Workers kullanan yazilim gelistiriciler
- Ajanslar ve cok domain yoneten ekipler
- SaaS kuruculari ve side project sahipleri
- `support@`, `info@`, `billing@`, `hello@` gibi project inbox'larini kendisi yonetmek isteyenler
- Cloudflare Email Routing kullanan ama pratik bir dashboard isteyenler
- R2 bucket'larini email workflow'u ile birlikte gormek isteyenler
- Gmail veya baska harici hesaplari operasyon paneline baglamak isteyenler
- Public GitHub projesi olarak fork-first, secret-safe, self-hosted bir sistem arayanlar

Uygun olmayan senaryolar:

- Cok buyuk kurumsal mailbox suite ihtiyaci
- Tam mail server, spam filtering, calendar, contacts sync, SSO gibi suite beklentisi
- Hic Cloudflare kullanmayan ekipler
- Teknik kurulum yapmak istemeyen kullanicilar

## 4. Temel Deger Onerisi

OmniDock'un ana degeri parcalanmis Cloudflare email ve storage islerini tek ekranda birlestirmesidir.

Cloudflare cok guclu primitive'ler verir:

- Workers
- Email Routing
- Email Sending
- D1
- R2
- Worker secrets
- Cron triggers
- Workers assets

Fakat bu primitive'lerin operasyonu genellikle farkli ekranlara bolunur. OmniDock bu daginikligi azaltir:

- Domainleri gorur.
- Email Sending durumunu gorur.
- Email Routing durumunu gorur.
- Catch-all veya tekil mailbox rule durumunu gorur.
- Gelen mailleri Worker ile alip D1/R2'ye kaydeder.
- Outbound mail gonderir.
- Harici Gmail/IMAP hesaplarini sync eder.
- R2 bucket'larini panelden gezdirir.
- Attachment preview, upload, download, delete islemlerini tek UI icine alir.
- Kontak, imza, log ve ayar islerini ayni panelde tutar.

## 5. Marka Tonu

OmniDock icin onerilen ton:

- Teknik ama sicak
- Guven veren
- "Self-hosted, senin verin sende" vurgusu olan
- Cloudflare-native
- Linux desktop / terminal hissine yakin
- Operasyon paneli gibi yogun ama duzenli
- Hype yerine net fayda anlatan

Kacinilacak ton:

- "Magic", "AI her seyi cozer" gibi abartili vaatler
- Tam email provider oldugunu ima etmek
- Secret veya credential guvenligini hafife almak
- One-click deploy'u fazla yuceltmek; proje fork-first yaklasimi kullaniyor

## 6. Ana Ozellikler

### 6.1 Mailbox Dashboard

OmniDock ana ekranda mail operasyonlarini toplar:

- Inbox, Sent ve Archive klasorleri
- Thread listesi
- Thread detay paneli
- Read/unread state
- Archive/unarchive
- Delete
- Reply editor
- Compose modal
- Mailbox secimi
- All mailboxes secenegi
- Search bar
- Per-mailbox sayaclar
- Default acilacak mailbox ayari
- Sync durumunu footer/status bar'da gosterme

Mailbox secimi iki seviyede dusunulmelidir:

- Internal Cloudflare-managed mailbox adresleri
- External Gmail/IMAP hesaplari

Kullanici tek bir mailbox secebilir veya tum mailbox'lari gorebilir. Compose ekraninda "From" alaninda gonderilebilir tum adresler listelenmelidir.

### 6.2 Compose Ve Reply

Compose deneyimi:

- From secimi
- To alaninda otomatik contact search
- Subject
- Rich text body
- Bold
- Italic
- Underline
- Text color
- Background color
- Link ekleme
- Otomatik link algilama
- Mailbox signature ekleme
- Attachment ekleme
- Attachment yukleme bitmeden email gondermeyi engelleme
- Sending loading state
- Hata durumunda kullaniciya net mesaj

Onemli UX notu:

Attach butonu ikon ve text hizasi duzgun olmali. Gonder butonu loading durumunda kalirsa hata log'a yazilmali ve UI kilitlenmemeli.

### 6.3 Cloudflare Internal Mail

Cloudflare internal mail akisinda OmniDock:

- Email Routing ile gelen mailleri Worker `email()` handler uzerinden alir.
- D1'e message/thread metadata kaydeder.
- R2'ye raw MIME ve attachment dosyalarini koyar.
- Email Sending binding ile gonderim yapar.
- Domain bazli sending/routing durumunu Cloudflare API ile kontrol eder.
- Tekil mailbox routing rule veya catch-all kurulumunu destekler.

Routing modlari:

- Mailbox rule: sadece belirli adres gelir, ornegin `support@example.com`.
- Catch-all: domain icin eslesmeyen tum adresler gelir.

Docs'ta bu iki mod net anlatilmalidir. Mailbox rule daha kontrollu ve guvenli default gibi anlatilmali; catch-all guclu ama daha genis kapsamli bir secenek olarak sunulmalidir.

### 6.4 Domains And Rules

Rules ekraninin amaci:

- Cloudflare account'tan domain/zone bilgilerini sync etmek
- Domainin Email Sending durumunu gostermek
- Domainin Email Routing durumunu gostermek
- Catch-all durumunu gostermek
- Mailbox rule durumunu gostermek
- Default domain secmek
- Domain altinda mailbox adresleri olusturmak

Domain ekleme mantigi:

Domainler ideal olarak Cloudflare account'tan sync edilmelidir. Kullanici domaini Cloudflare'da yonetir; OmniDock o domainleri cekip secilebilir yapar. Uygulama icinde domain "manual add" ekrani yerine Cloudflare sync ve secili domain uzerinden mailbox ekleme daha mantiklidir.

Status metinleri kullanici dostu olmali:

- "Can send from @example.com"
- "Cannot send yet"
- "Can receive all routed mail"
- "Can receive support@example.com only"
- "Catch-all enabled"
- "Routing inactive"
- "Inbound storage ready"
- "D1/R2 binding missing"

### 6.5 Contacts

Contacts bolumu:

- Manual contact ekleme
- Contact edit
- Contact delete
- Email
- Name
- Phone
- Company
- Tags
- Notes
- Source bilgisi
- CSV import
- TXT import
- VCF/vCard import
- Import log/report
- Duplicate merge veya update davranisi

Compose ekraninda contact dropdown ayrica olmamalidir. To alanina yazarken otomatik contact search calismalidir. Kullanici ad, email, telefon veya firma ile arama yapabilir.

Import sonucu net anlatilmalidir:

- Kac satir okundu
- Kac unique contact bulundu
- Kac contact eklendi
- Kac contact guncellendi
- Kac satir atlandi
- Hangi satirlarda hata vardi

### 6.6 Signatures

Signatures bolumu mailbox bazlidir.

Her mailbox icin:

- Enabled/disabled
- Rich text editor
- Plain text fallback
- HTML output
- Link support
- Style support
- Preview
- Save state

Imza editoru kaba textarea gibi degil, compose editor ile ayni kaliteye yakin olmalidir. Kullanici imzasinda link, renk, bold/italic, satir arasi ve basit HTML kullanabilmelidir.

### 6.7 External Email Accounts

External bolumu harici mail hesaplarini ekler.

Desteklenen provider kategorileri:

- Gmail
- Outlook
- Yahoo
- iCloud
- Custom IMAP/SMTP

Her external account icin:

- Provider
- Email
- Display name
- Auth type
- Inbound enabled
- Outbound enabled
- IMAP host
- IMAP port
- IMAP security
- SMTP host
- SMTP port
- SMTP security
- Notes
- Credential secret reference
- Last checked
- Last error
- Sync status

Kullanici icin basit model:

- Email alanina gercek email adresini yazar.
- Worker secrets tarafinda ayni email adresi veya uygulamanin bekledigi secret referansi ile credential degerini ekler.
- OmniDock credential degerini UI'da istemez ve D1'e kaydetmez.
- D1 sadece hesap metadata'sini ve secret referansini tutar.

Gmail icin docs metni:

Gmail normal Google sifresi ile kullanilmamalidir. Gmail icin App Password veya desteklenen OAuth secret yaklasimi gerekir. Gmail account icin IMAP ve SMTP ayarlari:

- IMAP host: `imap.gmail.com`
- IMAP port: `993`
- IMAP security: `SSL`
- SMTP host: `smtp.gmail.com`
- SMTP port: `587`
- SMTP security: `STARTTLS`

Gmail App Password notu:

Google hesabinda 2-Step Verification acik olmali ve App Password uretilmelidir. Bu app password Cloudflare Worker secret olarak girilir. Repoya, README orneklerine, D1'e veya browser storage'a yazilmaz.

External sync modeli:

- Sync butonuna basinca external account icin D1-backed job olusturulur.
- Worker kisa bir immediate run baslatir.
- Cron trigger her dakika job'lari devam ettirir.
- Her run maksimum 15 dakika calismali.
- Sure biterse cursor D1'de kalir.
- Kullanici tekrar Sync'e basinca veya cron devam ettiginde kalan mailler cekilir.
- Browser refresh veya sayfa kapatma sync'i iptal etmemelidir.
- Footer/status bar'da hangi hesap sync oluyor, kac imported/skipped/checked oldugu gorunmelidir.
- Hata olursa Logs ekranina yazilmalidir.

### 6.8 Buckets Ve R2 File Manager

Buckets bolumu Cloudflare R2 uzerinde dosya yonetimi saglar.

Primary bucket:

- `MAIL_BUCKET`
- Raw email
- Attachments
- Manual files

Extra buckets:

- `OMNIDOCK_EXTRA_R2_BUCKETS` build variable ile eklenir.
- Kullanici bucket adlarini virgulle yazar.
- Deploy script bu bucket'lar icin bindingleri korur.
- UI'da binding adi yerine gercek bucket display name gosterilir.

R2 ozellikleri:

- Bucket dropdown
- Folder/prefix browsing
- Breadcrumb
- Object list
- Preview panel
- PDF preview
- Image preview
- Text preview
- Download
- Delete
- Upload
- Upload progress
- Upload log
- Path search
- Text search
- Search selected bucket
- Search all buckets
- Turkish/non-English character aware search
- Saved text index

OCR ve text index yaklasimi:

OmniDock otomatik AI OCR calistirmaz. Bunun nedeni maliyeti kontrol etmek ve kullaniciyi surpriz billing riskinden korumaktir. Scanned PDF veya image icin kullanici `Index text` ile OCR text'i manuel veya kendi araci ile paste edebilir. OmniDock bu text'i D1'e kaydeder. Sonraki search'lerde bu saved text index kullanilir.

Docs'ta acik soylenmeli:

- Search path ve file name uzerinde hizlidir.
- Text search text dosyalari ve searchable PDF'lerde calisir.
- Scanned PDF/image icin OCR text index gerekir.
- Bu "OCR-ready" yaklasimdir, otomatik AI OCR degildir.

### 6.9 Logs And Audit

Logs bolumu tum onemli hareketleri gosterir:

- Email sent
- Email receive/store
- Cloudflare sync
- External account sync
- External SMTP send errors
- R2 upload
- R2 delete
- Text index add/remove
- Contact import
- Domain/rule changes
- Auth warnings
- Setup errors
- API errors

Logs ekrani:

- Search
- Filter
- Status badge
- Actor
- Resource id
- Detail text
- Export CSV
- Export JSON
- Selected rows export
- Single row delete
- Bulk delete
- Clear all
- DB'den silme

Logs, debugging icin urunun kritik parcasidir. Gmail send hata verirse, Cloudflare API auth hata verirse, R2 search timeout olursa veya external pull takilirsa bu kayit Logs ekraninda bulunabilmelidir.

### 6.10 Other Settings

Other Settings:

- Auto refresh interval
- Default: 10 seconds
- Off secenegi
- Manual Sync ile karismayan refresh
- Default mailbox secimi
- Default domain secimi
- UI palette secimi

Auto refresh sadece ekran verisini yenilemelidir. Login ekranina dusme, active sync'i iptal etme veya modal state'i beklenmedik sekilde kapatma gibi davranislar olmamalidir.

### 6.11 Themes And UI

OmniDock UI Linux/desktop operasyon paneli hissi tasir.

Palette'ler:

- Linux
- Ubuntu
- Fedora
- Plasma
- Graphite

UI prensipleri:

- Compact ama okunakli
- Kose ve hatlari net
- Card icinde card kalabaligi yok
- Dropdownlar native macOS gibi degil, app'in kendi design language'i ile acilmali
- Button hover durumlarinda text okunmali
- Badge genisligi text'e yetmeli
- Uzun path ve filename'ler ellipsis ile kisalmali
- Liste satirlari 2 satirdan fazla buyumemeli
- Loading state her kritik islemin uzerinde gorunmeli
- Browser native alert/confirm yerine app ici modal/dialog kullanilmali

## 7. Kurulum Felsefesi

OmniDock "fork-first" kurulum kullanir.

Neden one-click deploy degil:

- Cloudflare bindingleri ve secrets hassastir.
- D1 id, R2 bucket name, API token, admin password ve domain bilgileri upstream repoya girmemelidir.
- Kullanici kendi fork'una sahip olmalidir.
- Update'lerde binding kopma riski kontrol edilmelidir.
- Cloudflare Git deploy ayarlari kullanici fork'unda saklanmalidir.

Kurulum akisi:

1. Kullanici repoyu fork eder.
2. Cloudflare account'ta D1 database olusturur.
3. R2 bucket olusturur.
4. Worker from Git ile fork'u secer.
5. Build command ve deploy command'i girer.
6. Build variables ekler.
7. Runtime variables/secrets ekler.
8. Deploy eder.
9. Worker URL'sini acar.
10. Setup/check ekraninda eksik binding veya secret varsa gorur.
11. Eksikleri tamamlar.
12. Login/setup yapar.
13. Sync calistirir.
14. Mailbox ve rules olusturur.

## 8. Cloudflare Build Settings

Cloudflare Workers Git deploy ekraninda:

Build command:

```bash
npm run build
```

Deploy command:

```bash
node tools/deploy-preserving-bindings.mjs
```

Alternatif:

```bash
npm run deploy
```

Onemli uyari:

Normal Git deploy icin ciplak `npx wrangler deploy` kullanilmamalidir. Bu komut dashboard-only D1/R2 bindinglerini koruyamayabilir. OmniDock'un deploy-preserving script'i build variables ve mevcut Cloudflare config bilgisini okuyarak DB, MAIL_BUCKET ve extra R2 bindinglerini yeniden deploy config'e koyar.

## 9. Build-Time Variables

Bu degerler Cloudflare Workers Build configuration altina eklenmelidir.

Bu degerler runtime secret degildir; deploy sirasinda bindingleri dogru olusturmak icin kullanilir.

Required:

- `OMNIDOCK_D1_DATABASE_ID`
- `OMNIDOCK_R2_BUCKET_NAME`

Optional:

- `OMNIDOCK_D1_DATABASE_NAME`
- `OMNIDOCK_EXTRA_R2_BUCKETS`
- `WORKER_SCRIPT_NAME`
- `CLOUDFLARE_ACCOUNT_ID`

Aciklamalar:

`OMNIDOCK_D1_DATABASE_ID`

- D1 database id.
- Binding adi her zaman `DB` olmali.
- Yeni deploy/update sirasinda DB binding kopmasin diye gereklidir.

`OMNIDOCK_R2_BUCKET_NAME`

- Primary R2 bucket adi.
- Binding adi her zaman `MAIL_BUCKET` olmali.
- Raw mail, attachment ve manual file saklamak icin kullanilir.

`OMNIDOCK_D1_DATABASE_NAME`

- Sadece display/config kolayligi icindir.
- D1 id zaten asil kaynaktir.
- Zorunlu degildir.

`OMNIDOCK_EXTRA_R2_BUCKETS`

- Ek R2 bucket'lari eklemek icin kullanilir.
- Basit format: `client-files,media-files`
- Advanced format: `R2_CLIENT_FILES:client-files,R2_MEDIA:media-files`
- UI bucket adini gostermeli, binding adini kullaniciya gereksiz detay olarak gostermemelidir.

`WORKER_SCRIPT_NAME`

- Worker script adi default disinda ise gerekir.
- Email Routing rule olusturma gibi automation islerinde kullanilir.

`CLOUDFLARE_ACCOUNT_ID`

- API token birden fazla Cloudflare account'a erisebiliyorsa gerekir.
- Token sadece tek account'a erisiyorsa bos birakilabilir.

## 10. Runtime Variables And Secrets

Runtime degerleri Cloudflare Worker settings altinda Variables and Secrets bolumune girilir.

Secret olarak girilecekler:

- `ADMIN_PASSWORD`
- `CLOUDFLARE_API_TOKEN`
- External account app password veya OAuth secret referanslari

Plaintext variable olarak girilecekler:

- `PRIMARY_DOMAIN`
- `WORKER_SCRIPT_NAME`
- `MANAGEMENT_HOST`
- `PASSWORD_RESET_FROM`
- `CLOUDFLARE_ACCOUNT_ID`
- `R2_BUCKET_NAME` veya deploy script tarafindan uretilen display values
- `EXTRA_R2_BUCKETS` veya deploy script tarafindan uretilen display values

`ADMIN_PASSWORD`

- Ilk admin sifresi.
- Minimum 12 karakter onerilir.
- Plaintext variable olmamali.
- Uygulama bunu D1 icinde salted PBKDF2 hash olarak saklar.

`CLOUDFLARE_API_TOKEN`

- Cloudflare sync, routing checks ve rule automation icin gerekir.
- Plaintext olmamali.
- Least privilege ile olusturulmali.

`PRIMARY_DOMAIN`

- Ilk managed email domain.
- Secret degildir.
- Plaintext variable olmalidir.

`MANAGEMENT_HOST`

- Custom dashboard hostname.
- Ornek: `mail.example.com`, `dock.example.com`
- Secret degildir.

`PASSWORD_RESET_FROM`

- Reset email gonderimi icin verified sender.
- Secret degildir.
- Kullanilacaksa Cloudflare Email Sending tarafinda verified olmalidir.

External credential secrets:

- Gmail app password veya provider secret'i Worker secret olarak saklanir.
- UI bu degeri istememelidir.
- D1 sadece secret referansi/account metadata tutmalidir.

## 11. Required Bindings

OmniDock icin gerekli Worker bindings:

`DB`

- Cloudflare D1 database binding.
- Tum metadata, auth, sessions, messages, contacts, signatures, logs ve sync jobs icin kullanilir.

`MAIL_BUCKET`

- Primary Cloudflare R2 bucket binding.
- Raw mail, attachment, manual file ve mail-related storage icin kullanilir.

`EMAIL`

- Cloudflare Email Sending binding.
- Cloudflare-managed internal mailbox'lardan mail gondermek icin kullanilir.

`ASSETS`

- Workers assets binding.
- Built UI dosyalarini servis eder.

Extra R2 bindings:

- Build variable ile uretilir.
- Ornek binding: `R2_CLIENT_FILES`
- Kullaniciya UI'da bucket adi gosterilmelidir.

## 12. Binding Kopmasi Problemi Ve Cozum

Cloudflare Wrangler deploy config'i source of truth olarak gorur. Eger D1/R2 binding dashboard'da eklenmis ama deploy config icinde yoksa sonraki deploy bu bindingleri kaldirabilir.

OmniDock bu yuzden:

- Fake placeholder D1 id kullanmamalidir.
- Public repoda kullaniciya ait D1 id veya bucket adi tutmamalidir.
- Build-time variable'lardan deploy config uretmelidir.
- Deploy command olarak `node tools/deploy-preserving-bindings.mjs` kullanmalidir.
- Existing dashboard bindingleri okuyup korumaya calismalidir.
- Extra R2 bucket'lari `OMNIDOCK_EXTRA_R2_BUCKETS` ile takip etmelidir.

Docs'ta su cumle net gecmelidir:

**OmniDock'u Git deploy ile guncellerken bare `npx wrangler deploy` kullanmayin; bindingleri koruyan deploy komutunu kullanin.**

## 13. Ilk Setup Akisi

Ilk acilista app su kontrolleri yapmalidir:

- `DB` binding var mi?
- `MAIL_BUCKET` binding var mi?
- `EMAIL` binding var mi?
- `ADMIN_PASSWORD` secret var mi?
- `PRIMARY_DOMAIN` plaintext variable var mi?
- `CLOUDFLARE_API_TOKEN` secret var mi?

Eksik varsa kullanici login ekranina degil setup/check ekranina gitmelidir. Bu ekranda:

- Hangi binding/secret/plaintext eksik gosterilmeli
- Eklenenlerde check/tick gosterilmeli
- Eksiklerde required badge gosterilmeli
- Her variable name kopyalanabilir olmali
- Binding ve secret kavrami ayrilmali
- Domain plaintext olarak anlatilmali
- API token secret olarak anlatilmali

Setup tamamlaninca:

- Kullanici admin bilgilerini tamamlar.
- Password hash D1'e kaydedilir.
- Recovery email primary domain disinda olmalidir.
- Default domain kaydedilir.
- UI login'e veya dashboard'a gecer.

## 14. Guvenlik Modeli

OmniDock guvenlik prensipleri:

- Secret degerleri repoda olmamalidir.
- Browser admin password saklamamalidir.
- Admin login D1-backed HttpOnly SameSite session cookie ile calismalidir.
- Session token kendisi D1'e plaintext yazilmamalidir; hash'i yazilmalidir.
- Password D1'e plaintext yazilmamalidir; salted PBKDF2 hash saklanmalidir.
- Failed auth attempts rate limited olmalidir.
- Password reset token hash'lenmeli ve expire olmalidir.
- External email credentials sadece Worker secrets icinde tutulmalidir.
- D1 sadece secret name/reference tutmalidir.
- Cloudflare API token least privilege olmalidir.
- CSP/security headers bulunmalidir.
- HTML email render ederken sanitize/allowlist yaklasimi kullanilmalidir.
- Browser native alert yerine app dialoglari tercih edilmelidir.
- Delete gibi riskli islemler confirmation ister.
- Logs hata ayiklama icin yeterli ama secret degeri icermemelidir.

Public repo icin checklist:

- `.dev.vars` commit edilmemeli.
- D1 database id commit edilmemeli.
- R2 bucket private adlari commit edilmemeli.
- Cloudflare account id commit edilmemeli.
- API token commit edilmemeli.
- Admin password commit edilmemeli.
- Gmail app password commit edilmemeli.
- Personal email ve domain ornekleri generic hale getirilmeli.
- Git history temizlenmeli veya secret scanning uyarilari cozulmeli.
- GitHub Secret Scanning ve CodeQL acik olmali.

## 15. Architecture

Frontend:

- React
- Vite
- TypeScript
- Custom CSS
- Lucide icons
- Workers assets ile servis edilir

Worker:

- Cloudflare Workers runtime
- HTTP API routes
- `email()` handler
- Scheduled cron handler
- D1 access layer
- R2 object operations
- Cloudflare API integration
- External IMAP/SMTP sync/send logic

Storage:

- D1: metadata, messages, threads, contacts, signatures, external accounts, sync jobs, audit logs, admin auth, sessions
- R2: raw MIME, attachments, manual files, object preview/search assets

Inbound flow:

1. Cloudflare Email Routing maili Worker `email()` handler'a yollar.
2. Worker raw MIME'i parse eder.
3. Message/thread metadata D1'e yazilir.
4. Raw message ve attachment R2'ye yazilir.
5. UI refresh/sync ile yeni thread'i gosterir.

Outbound Cloudflare flow:

1. Kullanici compose/reply yapar.
2. From internal mailbox ise Cloudflare Email Sending binding kullanilir.
3. Signature ve attachment'lar eklenir.
4. Sent message D1/R2'ye kaydedilir.
5. Logs'a basari veya hata yazilir.

Outbound external flow:

1. From external Gmail/IMAP-SMTP account ise external SMTP profile kullanilir.
2. Credential Worker secret'tan okunur.
3. SMTP gonderim denenir.
4. Timeout/TLS/auth hata durumlari Logs ve UI notice icine yazilir.

External inbound sync flow:

1. Sync butonuna basilir.
2. D1'e external sync job kaydedilir.
3. Worker batch mail cekmeye baslar.
4. Cron kalan job'lari devam ettirir.
5. Cursor D1'de saklanir.
6. 15 dakika limit dolarsa job queued kalir ve tekrar devam edebilir.

R2 file flow:

1. Kullanici bucket secer.
2. Prefix/folder listelenir.
3. Object listesi gelir.
4. Preview/download/delete/upload/search islemleri API uzerinden yapilir.
5. Text index D1'e yazilir.

## 16. Kullanici Yolculuklari

### 16.1 Ilk Kurulum

1. GitHub'da fork al.
2. Cloudflare'da D1 ve R2 olustur.
3. Worker from Git ile fork'u bagla.
4. Build variables gir.
5. Runtime variables/secrets gir.
6. Deploy et.
7. Worker URL'sini ac.
8. Eksik varsa setup/check ekraninda tamamla.
9. Admin login yap.
10. Sync calistir.
11. Domaini sec.
12. Mailbox adresi olustur.
13. Routing rule veya catch-all etkinlestir.
14. Test email al.
15. Test email gonder.

### 16.2 Support Inbox Olusturma

1. Domain Cloudflare'da active olmali.
2. Email Routing acik olmali.
3. Email Sending verified olmali.
4. OmniDock Rules ekraninda domain secilir.
5. `support` mailbox eklenir.
6. Worker rule aktif edilir.
7. Sync calistirilir.
8. `support@example.com` mailbox listesine gelir.
9. Gelen mail Inbox'ta gorulur.
10. Reply veya compose ile cevap verilir.

### 16.3 Gmail Baglama

1. Gmail hesabinda IMAP aktif edilir.
2. Google App Password uretilir.
3. Cloudflare Worker secret olarak credential eklenir.
4. OmniDock External ekraninda Gmail account eklenir.
5. Inbound/outbound secenekleri ayarlanir.
6. Save account yapilir.
7. Sync ile eski mailler D1-backed job olarak cekilir.
8. From dropdown'da Gmail hesabindan gonderim yapilabilir.

### 16.4 R2 Bucket Yonetimi

1. `MAIL_BUCKET` otomatik olarak Buckets bolumunde gorulur.
2. Extra bucket istenirse `OMNIDOCK_EXTRA_R2_BUCKETS` build variable'ina eklenir.
3. Deploy edilir.
4. Buckets dropdown'dan bucket secilir.
5. Folder/prefix acilir.
6. Dosya preview edilir.
7. Upload progress ile dosya yuklenir.
8. Download veya delete yapilir.
9. Scanned dokuman icin `Index text` ile OCR text kaydedilir.
10. Text search bu index'i kullanir.

### 16.5 Log Ile Hata Ayiklama

1. Bir islem hata verirse Logs acilir.
2. Search ile provider, mailbox, bucket veya hata mesaji aranir.
3. Row detail incelenir.
4. Gerekirse CSV/JSON export alinir.
5. Eski veya gereksiz loglar selected/bulk delete ile D1'den silinir.

## 17. Web Sitesi Icin Onerilen Sayfa Yapisi

### Homepage

Bolumler:

1. Hero
2. Product screenshot
3. What is OmniDock?
4. Why Cloudflare email needs an operations dashboard
5. Core features
6. Mailbox workflow
7. External Gmail/IMAP sync
8. R2 bucket manager
9. Security model
10. Fork-first deploy
11. Screenshots
12. FAQ
13. GitHub CTA

Hero headline:

**OmniDock**

Hero subheading:

**Open-source email operations for Cloudflare Workers, Email Routing, Email Sending, D1, R2, Gmail sync, and external IMAP/SMTP accounts.**

Hero CTA:

- Fork on GitHub
- Read the Docs

Hero support copy:

Run your own private support inbox, multi-domain routing panel, external email sync, R2 file manager, contacts, signatures, logs, previews, uploads, and OCR-ready search from one Cloudflare-native Worker app.

### Docs

Docs sidebar:

1. Introduction
2. Concepts
3. Cloudflare preparation
4. Git deploy
5. Build variables
6. Runtime secrets and variables
7. Bindings
8. First setup
9. Mailboxes
10. Domains and rules
11. Compose and signatures
12. Contacts
13. External accounts
14. Gmail setup
15. R2 buckets
16. Text search and OCR-ready indexes
17. Logs
18. Security
19. Troubleshooting
20. Upgrades and binding preservation
21. FAQ

## 18. SEO Metinleri

Primary title:

OmniDock - Open-source Cloudflare Email Operations Dashboard

Alternative titles:

- OmniDock - Self-hosted Cloudflare Email Dashboard
- OmniDock - Cloudflare Workers Email Routing, Sending, D1 and R2 UI
- OmniDock - Support Inbox, Gmail Sync and R2 Bucket Manager for Cloudflare

Meta description:

OmniDock is an open-source Cloudflare Workers email operations dashboard for Email Routing, Email Sending, D1, R2 bucket management, Gmail and external IMAP/SMTP sync, contacts, signatures, logs, previews, uploads, and OCR-ready search.

Keywords:

- OmniDock
- Cloudflare email dashboard
- Cloudflare Workers email
- Cloudflare Email Routing UI
- Cloudflare Email Sending dashboard
- Cloudflare D1 email database
- Cloudflare R2 bucket manager
- self-hosted support inbox
- open-source email dashboard
- Gmail IMAP sync
- external IMAP SMTP accounts
- R2 attachment storage
- PDF preview
- OCR-ready search
- serverless email dashboard
- multi-domain email routing

GitHub About description:

Open-source Cloudflare email dashboard for Workers, Email Routing, Email Sending, D1, R2 bucket management, support inboxes, Gmail sync, external IMAP/SMTP, previews, uploads, contacts, signatures, logs, and OCR-ready search.

GitHub topics:

```text
cloudflare
cloudflare-workers
cloudflare-email-routing
cloudflare-email-sending
cloudflare-d1
cloudflare-r2
email-dashboard
support-inbox
self-hosted-email
email-routing
email-sending
r2-storage
r2-bucket-manager
d1-database
gmail-sync
external-email
imap
smtp
pdf-preview
ocr-indexing
serverless
react
typescript
open-source
```

## 19. FAQ

### OmniDock bir email provider mi?

Hayir. OmniDock kendi basina hosted mailbox provider degildir. Cloudflare Workers, Email Routing, Email Sending, D1 ve R2 uzerinde calisan operasyon panelidir.

### OmniDock ile email alabilir miyim?

Evet, Cloudflare Email Routing ile Worker'a yonlendirilen mailler OmniDock tarafindan alinabilir, D1/R2'ye kaydedilebilir ve UI'da gosterilebilir.

### OmniDock ile email gonderebilir miyim?

Evet. Cloudflare Email Sending verified domainlerinden veya configured external SMTP hesaplarindan gonderim yapabilir.

### Gmail baglanabilir mi?

Evet. Gmail external account olarak eklenebilir. Gmail icin normal Google sifresi yerine App Password veya uygun secret yapisi kullanilmalidir. Credential degeri Worker secret'ta kalir.

### Birden fazla Gmail hesabı eklenebilir mi?

Evet. Her account kendi email adresi ve kendi Worker secret referansi ile eklenir.

### R2 bucket yonetebilir mi?

Evet. Primary `MAIL_BUCKET` ve extra R2 bucket'lar UI'da secilebilir. Folder browsing, preview, upload, download, delete ve search desteklenir.

### OCR var mi?

OmniDock otomatik AI OCR calistirmaz. Scanned PDF veya image icin OCR text'i kullanici `Index text` ile kaydedebilir. Bu sayede sonraki aramalarda dosya bulunabilir. Bu yaklasim "OCR-ready text indexing" olarak anlatilmalidir.

### Binding neden kopar?

Wrangler deploy config'i source of truth sayar. Dashboard'da eklenen D1/R2 binding deploy config'te yoksa update sirasinda kalkabilir. Bu nedenle OmniDock `node tools/deploy-preserving-bindings.mjs` komutunu ve build variables'i kullanir.

### One-click deploy var mi?

Temel yaklasim fork-first deploy'dur. One-click deploy yerine kullanicinin kendi fork'u ve kendi Cloudflare kaynaklari ile kurulum hedeflenir.

### Veriler nerede durur?

Metadata D1'de, raw mail ve attachment'lar R2'de, secrets Cloudflare Worker secrets icinde durur. Repo ve browser storage secret degeri tasimamali.

### Admin password browser'da saklanir mi?

Hayir. Login D1-backed HttpOnly SameSite session cookie ile calismalidir. Admin password browser storage'da tutulmamali.

## 20. Troubleshooting Bolumleri

Docs'ta mutlaka bu hata senaryolari olmali:

### D1 binding DB is not configured

Sebep:

- Worker'da `DB` binding yok.
- Build variable eksik.
- Bare `npx wrangler deploy` bindingi sildi.

Cozum:

- Cloudflare'da D1 database olustur.
- Binding name `DB` olacak sekilde bagla.
- `OMNIDOCK_D1_DATABASE_ID` build variable ekle.
- Deploy command'i `node tools/deploy-preserving-bindings.mjs` yap.
- Deploy et.

### MAIL_BUCKET binding is not configured

Sebep:

- Primary R2 bucket yok veya binding adi yanlis.

Cozum:

- R2 bucket olustur.
- Binding name `MAIL_BUCKET` olacak sekilde bagla.
- `OMNIDOCK_R2_BUCKET_NAME` build variable ekle.
- Deploy et.

### Email send calismiyor

Kontrol:

- From internal mi external mi?
- Internal ise Cloudflare Email Sending verified mi?
- External ise SMTP host/port/security dogru mu?
- Gmail ise app password dogru mu?
- Worker secret var mi?
- Logs ekraninda TLS/auth/timeout hata mesaji var mi?

### Gmail sync takildi

Kontrol:

- External account inbound enabled mi?
- Secret var mi?
- IMAP enabled mi?
- App password dogru mu?
- Logs hata veriyor mu?
- Footer'da job queued/running/completed durumu var mi?
- 15 dakika limit dolduysa Sync tekrar calistir.

### Search gec cevap veriyor

Sebep:

- All buckets + text search cok fazla obje tarayabilir.
- PDF text extraction zaman alabilir.
- Scanned PDF otomatik OCR yapmaz.

Cozum:

- Once current bucket ara.
- Path search kullan.
- Gerekli dosyalara `Index text` ekle.
- Logs'ta search duration/time limit/issue kaydini kontrol et.

### PDF text search sonuc bulmuyor

Sebep:

- PDF scanned image olabilir.
- PDF text layer icermiyor olabilir.
- OCR index yoktur.

Cozum:

- PDF'i ac.
- `Index text` ile OCR text paste et.
- Tekrar search yap.

## 21. Kalite Ve UX Notlari

Web/docs tarafinda screenshot ve copy kullanirken su kalite notlari vurgulanabilir:

- Uygulama operasyon ekranidir; landing page gibi degil, gercek dashboard gibi tasarlanmistir.
- Search bar buyuk ve merkezdedir.
- Mailbox dropdown search bar ile ayni hizada olmalidir.
- Dropdownlar app stilinde olmalidir.
- Delete/confirm islemleri app dialog ile yapilmalidir.
- Hover durumlarinda text okunabilir kalmalidir.
- Uzun dosya path'leri ellipsis ile kisaltilmalidir.
- Badge'ler text'e gore genislemelidir.
- Loading ve progress states kritik islemlerde gorunmelidir.
- Footer/status bar sistem hareketlerini gostermelidir.

## 22. Website Icin Hazir Feature Cards

Card: Cloudflare Email Dashboard

OmniDock turns Cloudflare Email Routing and Email Sending into a practical support inbox. Receive routed mail, reply from verified addresses, manage mailbox rules, and keep thread metadata in D1.

Card: Gmail And External Email Sync

Connect Gmail, Outlook, Yahoo, iCloud, or custom IMAP/SMTP accounts. Credentials stay in Worker secrets while resumable sync jobs and cursors live in D1.

Card: R2 Bucket Manager

Browse primary and extra R2 buckets, preview PDFs, images, and text files, upload batches with progress, download objects, delete files, and search paths or saved text indexes.

Card: Contacts And Signatures

Import contacts from CSV, TXT, or VCF, edit phone/company/tags/notes, search contacts while composing, and attach rich mailbox-specific signatures to outgoing mail.

Card: Logs And Debugging

Review sends, syncs, Cloudflare routing checks, external account errors, uploads, deletes, and search warnings in a D1-backed audit log with export and cleanup actions.

Card: Secret-Safe Self Hosting

Fork first, deploy to your own Cloudflare account, store credentials in Worker secrets, keep metadata in D1, files in R2, and avoid committing personal tokens or resource ids.

## 23. Docs Icin Hazir Kurulum Ozeti

Quick start:

```text
1. Fork OmniDock.
2. Create a Cloudflare D1 database.
3. Create a Cloudflare R2 bucket.
4. Create a Worker from Git using your fork.
5. Set Build command to npm run build.
6. Set Deploy command to node tools/deploy-preserving-bindings.mjs.
7. Add OMNIDOCK_D1_DATABASE_ID and OMNIDOCK_R2_BUCKET_NAME as build variables.
8. Add ADMIN_PASSWORD and CLOUDFLARE_API_TOKEN as Worker secrets.
9. Add PRIMARY_DOMAIN as a plaintext Worker variable.
10. Deploy, open the Worker URL, complete setup, run Sync, and create mailbox rules.
```

## 24. Docs Icin Hazir Security Ozeti

Security summary:

```text
OmniDock is designed for self-hosted Cloudflare deployments. Secrets are not stored in the repository or browser storage. Admin authentication uses D1-backed HttpOnly SameSite sessions, and passwords are stored as salted PBKDF2 hashes. External email credentials are referenced by secret name and stored as Cloudflare Worker secrets. D1 stores metadata, R2 stores mail files and attachments, and Cloudflare API automation should use least-privilege tokens.
```

## 25. Diger Sohbete Verilecek Hazir Prompt

Asagidaki prompt, baska bir chat'te web sitesi ve docs uretmek icin kullanilabilir:

```text
OmniDock adli open-source/self-hosted Cloudflare email operations dashboard icin modern, SEO dostu bir web sitesi ve detayli dokumantasyon olustur. Urun Cloudflare Workers, Email Routing, Email Sending, D1, R2, Gmail/external IMAP-SMTP sync, contacts, signatures, logs, R2 bucket manager, file preview, upload progress, PDF/image/text preview, OCR-ready text indexing, Linux-style dashboard ve fork-first secure deployment ozelliklerine sahip.

Landing page hero'su marka adini "OmniDock" olarak tasimali. Mesaj: "Open-source email operations for Cloudflare Workers, Email Routing, Email Sending, D1, R2, Gmail sync, and external IMAP/SMTP accounts." Site, SaaS degil self-hosted urun oldugunu acik anlatmali. One-click deploy yerine fork-first deploy yaklasimini savunmali. Cloudflare binding kopmasi problemini ve deploy-preserving command'i net anlatmali.

Docs bolumleri: Introduction, Concepts, Cloudflare preparation, Git deploy, Build variables, Runtime secrets and variables, Bindings, First setup, Mailboxes, Domains and rules, Compose and signatures, Contacts, External accounts, Gmail setup, R2 buckets, Text search and OCR-ready indexes, Logs, Security, Troubleshooting, Upgrades and FAQ.

SEO keywords: Cloudflare email dashboard, Cloudflare Workers email, Cloudflare Email Routing UI, Cloudflare Email Sending dashboard, self-hosted support inbox, Gmail IMAP sync, external IMAP SMTP accounts, R2 bucket manager, D1 email database, PDF preview, OCR-ready search, serverless email dashboard.

Tasarim dili: compact, technical, premium, Linux desktop inspired. Gercek uygulama screenshot'lari ve teknik guven veren copy kullan. Abartili AI iddialari kullanma. Secret-safe, self-hosted, Cloudflare-native ve developer-friendly vurgusu yap.
```

## 26. Son Not

OmniDock anlatilirken ana fikir sudur:

**Cloudflare email ve storage primitive'lerini bilen gelistiriciler icin OmniDock, kendi Worker'inda calisan, veriyi kendi D1/R2 kaynaklarinda tutan, secret'lari Cloudflare'da saklayan, cok domainli email operasyonlarini tek dashboard'da yoneten acik kaynakli bir kontrol merkezidir.**
