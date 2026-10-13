/* 경제마을 캠프 — 공통 스크립트 (API 호출·QR 스캔·QR 생성·알림음) */
(function () {
  const CFG = window.CAMP_CONFIG || {};

  // 이 사이트의 기본 주소 (예: https://아이디.github.io/econ-camp/)
  const BASE = location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');

  async function api(action, payload) {
    if (!CFG.API_URL || CFG.API_URL.indexOf('여기에') >= 0) {
      return { ok: false, msg: 'config.js의 API_URL이 설정되지 않았습니다' };
    }
    const body = JSON.stringify(Object.assign({ action: action }, payload || {}));
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(CFG.API_URL, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 사전요청(CORS preflight) 없이 전송
          body: body,
        });
        const text = await res.text();
        try { return JSON.parse(text); }
        catch (e) { return { ok: false, msg: '서버 응답을 읽을 수 없습니다 — API_URL과 배포(액세스: 모든 사용자)를 확인하세요' }; }
      } catch (e) {
        lastErr = e;
        // 읽기 요청만 1회 재시도(쓰기 요청은 중복 처리 위험 때문에 재시도하지 않음)
        if (!/^(ping|booth\.info|me|admin\.dashboard|admin\.students|admin\.student|bank\.lookup|admin\.awards|admin\.cards|admin\.booths|admin\.config|admin\.stocks)$/.test(action)) break;
        await new Promise(r => setTimeout(r, 800));
      }
    }
    return { ok: false, net: true, msg: '연결 오류 — Wi-Fi(인터넷)를 확인한 뒤 다시 시도하세요' };
  }

  // 카드 QR 문자열에서 학생번호 6자리 추출(화면 쪽 확인용)
  function sidOf(code) {
    let s = String(code || '');
    const m = s.match(/[?&]c=([^&#]+)/);
    if (m) s = decodeURIComponent(m[1]);
    const mm = s.toUpperCase().replace(/[^0-9A-Z]/g, '').match(/(\d{6})[A-Z]{4}$/);
    return mm ? mm[1] : '';
  }

  function cardUrl(sid, token) { return BASE + 'me.html?c=' + sid + '-' + token; }
  function boothUrl(id, key) { return BASE + 'booth.html?b=' + id + '&k=' + key; }

  // QR 생성 (qrcode-generator 라이브러리)
  function qrSvg(text, cell) {
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: cell || 4, margin: 2, scalable: true });
  }

  // 알림음 (성공: 높은 음 2번 / 실패: 낮은 음)
  let actx = null;
  function beep(ok) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const tones = ok ? [880, 1320] : [220];
      tones.forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.18, actx.currentTime + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + i * 0.12 + (ok ? 0.12 : 0.35));
        o.connect(g); g.connect(actx.destination);
        o.start(actx.currentTime + i * 0.12); o.stop(actx.currentTime + i * 0.12 + 0.4);
      });
    } catch (e) { /* 소리 미지원 기기 무시 */ }
    if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]);
  }

  // 카메라 QR 스캐너 (html5-qrcode). onCode(text) 호출.
  // 같은 카드를 계속 대고 있으면 연속 인식되므로, 같은 코드는 '카드를 뗀 뒤(1.5초 이상 안 보임)'에만 다시 인정
  function scanner(elId, onCode, opt) {
    opt = opt || {};
    let qr = null, last = '', lastT = 0, running = false;
    const prefKey = 'camFacing';
    let facing = localStorage.getItem(prefKey) || opt.facing || 'environment';
    async function start() {
      if (!window.Html5Qrcode) { opt.onError && opt.onError('스캐너 라이브러리를 불러오지 못했습니다(인터넷 확인)'); return; }
      try {
        qr = qr || new Html5Qrcode(elId, { verbose: false });
        await qr.start({ facingMode: facing },
          { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.72); return { width: s, height: s }; } },
          (text) => {
            const t = Date.now();
            if (text === last && t - lastT < 1500) { lastT = t; return; }   // 아직 같은 카드가 화면에 있음
            last = text; lastT = t;
            onCode(text);
          }, () => {});
        running = true;
      } catch (e) {
        running = false;
        opt.onError && opt.onError('카메라를 켤 수 없습니다 — 카메라 권한을 허용했는지, https 주소로 열었는지 확인하세요. (번호 직접 입력은 계속 가능합니다)');
      }
    }
    async function stop() { try { if (qr && running) await qr.stop(); } catch (e) {} running = false; }
    async function flip() {
      facing = facing === 'environment' ? 'user' : 'environment';
      localStorage.setItem(prefKey, facing);
      await stop(); await start();
    }
    function reset() { last = ''; lastT = 0; }
    return { start, stop, flip, reset, get running() { return running; } };
  }

  function fmt(n) { n = Number(n) || 0; return (n > 0 ? '+' : '') + n; }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function hhmm(iso) { const d = new Date(iso); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  // 화면 꺼짐 방지(지원 기기)
  async function keepAwake() {
    try { if ('wakeLock' in navigator) { let l = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') l = await navigator.wakeLock.request('screen'); }); } } catch (e) {}
  }

  window.Camp = { api, sidOf, cardUrl, boothUrl, qrSvg, beep, scanner, fmt, esc, hhmm, keepAwake, BASE };
})();
