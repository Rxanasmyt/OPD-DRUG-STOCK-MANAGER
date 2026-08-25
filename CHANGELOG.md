# Changelog

รูปแบบอิงตาม [Keep a Changelog](https://keepachangelog.com/) และเวอร์ชันตาม [Semantic Versioning](https://semver.org/)

> **หมายเหตุเรื่อง git tag:** session ที่ดูแล repo นี้ไม่มีสิทธิ์ push `refs/tags/*` ขึ้น GitHub
> (branch push ปกติทำได้ แต่ tag push โดน 403 เสมอ — น่าจะเป็น guardrail ของแพลตฟอร์ม ไม่ใช่ปัญหา scope)
> และไม่มีเครื่องมือสำหรับสร้าง GitHub Release ในชุดเครื่องมือที่ใช้งานได้ จึงใช้ไฟล์นี้ + `VERSION`
> เป็นแหล่งความจริงของเลขเวอร์ชันแทน จนกว่าจะแก้ข้อจำกัดนั้นได้

## [1.0.0] - 2026-08-25

### Added
- **feat:** implement OPD drug stock manager from Claude Design prototype — เว็บแอป React + TypeScript
  + Vite ตาม flow เต็มรูปแบบของดีไซน์ `ระบบสต็อกยา OPD.dc.html` (login 3 บทบาท, เติมหน้างานแบบ FEFO,
  รับเข้า substock พร้อมอนุมัติ, ปรับยอด/คืนยา/ยาหมดอายุ, นำเข้า HOSxP, นับสต็อก, รายงาน, ฉลาก QR,
  จัดการผู้ใช้ + audit log) พร้อม master data ยา 585 รายการจาก `med_list_utf8.csv`
- **feat:** ใช้ Claude Artifact `downloads` capability สำหรับ export CSV พร้อม fallback เป็นการดาวน์โหลด
  แบบปกติเมื่อรันนอก Artifact viewer

### Infrastructure
- **ci:** เพิ่ม GitHub Actions workflow deploy อัตโนมัติขึ้น GitHub Pages (branch `gh-pages`) ทุกครั้งที่
  push เข้า `main`
