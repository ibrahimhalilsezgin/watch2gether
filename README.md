# 🎬 Watch2Gether (Next.js + WebSocket)

Eşzamanlı YouTube izleme, canlı sohbet ve hesap yönetimli gerçek zamanlı web uygulaması.

## 🚀 Özellikler

- **Eşzamanlı Video Senkronu:** YouTube IFrame API + WebSocket ile milisaniyelik lockstep oynatma, duraklatma ve sarma.
- **Kesintisiz Heartbeat:** Sunucudan yayınlanan zaman damgalarıyla istemciler arası kaymalar otomatik düzeltilir.
- **Oda Sahibi Odak Koruması:** Oda sahibi tarayıcı sekmesini alta aldığında video tüm odada otomatik olarak durur.
- **Odaya Katılma:** Ana sayfadan doğrudan oda kodu (`#id`) veya linkiyle anında odaya girilebilir.
- **Canlı Sohbet & Katılımcılar:** Katılımcı listesi, sahip rozetleri (`👑`) ve anlık mesajlaşma.
- **Hesap & Güvenlik:** Node.js yerel `node:sqlite` ve `node:crypto` (scrypt hash) ile sıfır harici veritabanı bağımlılığı.
- **Mobil & WebView Hazır:** `viewport-fit=cover`, safe-area-inset ve esnek 16:9 responsive tasarım.

## 🛠️ Kurulum & Çalıştırma

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme sunucusunu başlat
npm run dev
```

Tarayıcınızda açın: [http://localhost:3000](http://localhost:3000)

## 🧪 Test

```bash
node test-e2e.js
```
