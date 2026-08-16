const THRESHOLD = 68
const MAX_PULL = 104
const RESISTANCE = 0.5

// A standalone PWA has no browser chrome to pull against, so the app supplies
// its own gesture. Only engages at the very top of the page.
export function enablePullToRefresh(indicator: HTMLElement, onRefresh: () => Promise<void>) {
  let startY = 0
  let distance = 0
  let tracking = false
  let running = false

  const settle = () => {
    indicator.style.transform = ''
    indicator.classList.remove('is-pulling', 'is-ready')
    distance = 0
    tracking = false
  }

  document.addEventListener(
    'touchstart',
    (event) => {
      if (running || window.scrollY > 0 || event.touches.length !== 1) return
      startY = event.touches[0].clientY
      tracking = true
      distance = 0
    },
    { passive: true },
  )

  document.addEventListener(
    'touchmove',
    (event) => {
      if (!tracking || running) return
      const delta = event.touches[0].clientY - startY
      // a downward drag at scroll top is ours; anything else is a normal scroll
      if (delta <= 0 || window.scrollY > 0) {
        settle()
        return
      }
      event.preventDefault()
      distance = Math.min(delta * RESISTANCE, MAX_PULL)
      indicator.classList.add('is-pulling')
      indicator.classList.toggle('is-ready', distance >= THRESHOLD)
      indicator.style.transform = `translateY(${distance}px)`
    },
    { passive: false },
  )

  document.addEventListener(
    'touchend',
    () => {
      if (!tracking || running) return
      if (distance < THRESHOLD) {
        settle()
        return
      }
      running = true
      tracking = false
      indicator.classList.remove('is-pulling', 'is-ready')
      indicator.classList.add('is-loading')
      indicator.style.transform = `translateY(${THRESHOLD}px)`
      void onRefresh().finally(() => {
        indicator.classList.remove('is-loading')
        settle()
        running = false
      })
    },
    { passive: true },
  )
}

// resolves when fresh stats land, or gives up so the spinner can never hang
export function waitForRefresh(timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.removeEventListener('stats:changed', finish)
      resolve()
    }
    window.addEventListener('stats:changed', finish)
    setTimeout(finish, timeoutMs)
  })
}
