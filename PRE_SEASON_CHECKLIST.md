# APEX FPL HQ — Pre-Season Checklist (26/27)
ทำครั้งเดียวก่อน GW1 ของซีซันใหม่

## Apps Script (ทำก่อน GW1 deadline ~1 สัปดาห์)
- [ ] เปิด apex_3way.gs → อัป GITHUB_TOKEN (ถ้า PAT หมดอายุ)
- [ ] เปลี่ยน GEMINI_MODEL เป็น "gemini-2.5-flash" (หรือรุ่นล่าสุดที่ key เข้าถึงได้)
- [ ] รัน apexTestPush() → เช็คว่า data/cache/_ping.json โผล่ใน repo
- [ ] รัน setupExportTrigger() → ตั้ง trigger พฤหัส 20:45 (รันครั้งเดียว)
- [ ] รัน runWeeklyPipeline() ทดสอบ → เช็ค SQUAD/XPTS/NEWS ใน Sheet มีข้อมูล
- [ ] รัน runExport3Way() ทดสอบ → เช็ค data/cache/gemini.json บน repo มี captain จริง

## Claude Code (ทำก่อน GW1)
- [ ] pull latest main → ตรวจ .claude/agents/ ครบ 12 files
- [ ] รัน /brief [gw_ล่าสุด] ทดสอบ → director.json ถูก push เข้า main (ไม่มี branch ค้าง)
- [ ] เปิด office/index.html → กด LOAD REPORTS → 3-way โชว์ครบ YOU/GEMINI/CLAUDE
- [ ] คลิกการ์ดแต่ละฝั่ง → popup ทีม 15 ตัวขึ้น (ถ้า squad.json มีข้อมูล)

## GitHub Pages
- [ ] https://puwakies.github.io/apex-fpl-hq/office/ โหลดได้
- [ ] https://puwakies.github.io/apex-fpl-hq/data/cache/squad.json ไม่ใช่ 404

## Backtest (optional — ทำได้ตลอดซีซัน)
- [ ] รัน blindSimPrep() ใน Apps Script (ดึงข้อมูลผู้เล่นทั้งลีก)
- [ ] รัน exportBacktestData() → data/backtest/ มีไฟล์ครบ
- [ ] /backtest 1 10 → ตรวจว่า results.json มี per-player pts ฝังใน xi (ไม่ใช่ string ล้วน)
- [ ] เปิด office/backtest.html → LOAD BACKTEST → กราฟขึ้น

## GW1 Brief (ทำทุกสัปดาห์)
1. รอ Apps Script trigger พฤหัส 20:45 (อัตโนมัติ)
2. Claude Code 21:00 → /brief [gw]
3. เปิด office → LOAD REPORTS → ดู consensus
4. **กัปตัน: AI แนะนำ season-leader แต่คุณตัดสินใจเองด้วย injury/lineup realtime**
   (human beat AI 47% vs 42% top-3 — ใช้ข้อมูลที่ AI ไม่มีให้เต็มที่)
5. Rotation gate: ถ้า AI แนะนำ start ตัวที่คุณรู้ว่า rotate → override ได้เลย
