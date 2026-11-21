const hub = 'https://dtmapp.web.app'
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)))

export async function handleHubSso({app,signIn,logout}) {
  if (window.location.hash === '#dtm-logout') {
    window.history.replaceState(null,'',window.location.pathname)
    await logout()
    window.location.replace(app === 'housing' ? 'https://dtm-work-orders.web.app/#dtm-logout' : hub)
    return true
  }
  if (window.location.hash === '#dtm-hub') {
    const state = random(), verifier = random()
    sessionStorage.setItem('dtm-hub-handoff',JSON.stringify({state,verifier,createdAt:Date.now()}))
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))
    window.location.replace(hub+'/?'+new URLSearchParams({app,state,challenge}))
    return true
  }
  const params = new URLSearchParams(window.location.hash.slice(1))
  if (!params.has('dtm-sso')) return false
  window.history.replaceState(null,'',window.location.pathname)
  let pending
  try {pending=JSON.parse(sessionStorage.getItem('dtm-hub-handoff'))} catch { /* Invalid handoff data is rejected below. */ }
  sessionStorage.removeItem('dtm-hub-handoff')
  if (!pending || pending.state !== params.get('state') || pending.createdAt < Date.now()-15*60000) {
    throw Error('This sign-in request expired or did not start in this browser tab. Open the app from DTM Hub again.')
  }
  const response = await fetch('/api/dtm-access/hub/redeem',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({app,code:params.get('dtm-sso'),verifier:pending.verifier})
  })
  const result = await response.json()
  if(!response.ok) throw Error(result.error || 'Shared sign-in could not be completed. Open the app from DTM Hub again.')
  if(signIn) await signIn(result.customToken)
  return false
}
