// The phone's push system, faked in the page before any app script runs (snow alerts: test/push.spec.js, test/notify.spec.js).
// o: { permission ('default' | 'granted' | 'denied'), answer (what the prompt answers), subscribed (a subscription already in the
// browser, made with the key given), push (false = no PushManager and no Notification), ios, standalone, askMs (how long the
// prompt stays up) }. window.__push records: calls in order, whether each permission request ran INSIDE the tap's click
// handling (an iPhone refuses one that does not), unsubscribes.
async function fakePush(page, o, endpoint, key) {
  await page.addInitScript(([o, endpoint, key]) => {
    const P = window.__push = { calls: [], inClick: false, askedInClick: [], unsubs: 0 };
    // A capturing listener on window runs before the app's document listener; a bubbling one on window runs after it.
    window.addEventListener('click', () => { P.inClick = true; }, true);
    window.addEventListener('click', () => { P.inClick = false; }, false);
    const bytesOf = (b64) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
    let current = null;
    const mkSub = (keyBuf) => {
      const s = { endpoint, options: { applicationServerKey: keyBuf },
        unsubscribe() { P.calls.push('unsubscribe'); P.unsubs++; if (current === s) current = null; return Promise.resolve(true); } };
      return s;
    };
    if (o.subscribed) current = mkSub(bytesOf(key).buffer);
    const reg = { pushManager: {
      getSubscription() { return Promise.resolve(current); },
      subscribe(opts) { P.calls.push('subscribe'); current = mkSub(opts.applicationServerKey.buffer || opts.applicationServerKey); return Promise.resolve(current); } } };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
      getRegistration() { return Promise.resolve(reg); }, register() { return Promise.resolve(reg); }, ready: Promise.resolve(reg) } });
    Object.defineProperty(window, 'PushManager', { configurable: true, writable: true, value: o.push === false ? undefined : function PushManager() {} });
    let perm = o.permission || 'default';
    function Notification() {}
    Object.defineProperty(Notification, 'permission', { get: () => perm });
    Notification.requestPermission = function () {
      P.calls.push('requestPermission'); P.askedInClick.push(P.inClick);
      return new Promise((res) => setTimeout(() => { perm = o.answer || 'granted'; res(perm); }, o.askMs || 30));
    };
    Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: o.push === false ? undefined : Notification });
    if (o.ios) Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
    if (o.standalone) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  }, [o || {}, endpoint, key]);
}

module.exports = { fakePush };
