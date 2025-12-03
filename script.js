async function loadJson(path) {
  try {
    const res = await fetch(path, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.warn('Failed to load', path, err)
    return null
  }
}

const DEFAULT_SETTINGS = { defaultLanguage: 'en', defaultTheme: 'dark', defaultAutoplay: false }
const TEMPLATE_PATH = 'content/template.json'

let settings = { ...DEFAULT_SETTINGS }
let strings = {}
let profile = {}
let projects = []
// Add a small whitelist for external hosts which we will allow to embed in the iframe.
const ALLOWED_EMBED_HOSTS = new Set([
  'kronos-live.pages.dev'
])

function applyTheme(theme) {
  const html = document.documentElement
  const body = document.body
  if (theme === 'light') {
    body.classList.remove('dark')
    html.classList.add('light')
    document.getElementById('themeToggle').textContent = '☀️'
    document.getElementById('themeToggle').setAttribute('aria-pressed', 'false')
  } else {
    body.classList.add('dark')
    html.classList.remove('light')
    document.getElementById('themeToggle').textContent = '🌙'
    document.getElementById('themeToggle').setAttribute('aria-pressed', 'true')
  }
}

function updateTextNodes() {
  // resolve nested keys like 'contact.contact_title'
  const resolveKey = (k) => {
    if (!k) return ''
    const parts = k.split('.')
    let cur = strings
    for (const p of parts) { if (cur && typeof cur[p] !== 'undefined') { cur = cur[p] } else { return '' } }
    return typeof cur === 'string' ? cur : ''
  }
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')
    const value = resolveKey(key) || (strings && strings[key]) || ''
    if (value) el.textContent = value
  })
}

function buildProjectCard(p, idx) {
  const card = document.createElement('article')
  card.className = 'project-card'
  card.setAttribute('role', 'button')
  card.setAttribute('tabindex', '0')
  // allow a number of video id sources: videoId, youtube_id, youtube_embed (template or url)
  // support multiple source keys for site embeds or youtube ids
  const videoId = p.videoId || p.video_id || p.youtube_id || p.youtubeId || p.video_url || p.embed || p.embed_url || ''
  card.setAttribute('data-video-id', videoId)
  if (p.youtube_embed && p.youtube_embed.includes('{{id}}') && p.youtube_id) {
    card.setAttribute('data-youtube', p.youtube_embed.replace('{{id}}', p.youtube_id))
  } else if (p.youtube_embed && !p.youtube_embed.includes('{{id}}')) {
    card.setAttribute('data-youtube', p.youtube_embed)
  }
  // demo link / external site
  if (p.demo_link) card.setAttribute('data-demo-link', p.demo_link)
  else if (p.demoLink) card.setAttribute('data-demo-link', p.demoLink)
  else if (p.link) card.setAttribute('data-demo-link', p.link)
  else if (p.repo_link) card.setAttribute('data-demo-link', p.repo_link)
  card.setAttribute('data-project-id', p.id || `p${idx}`)
  // set accessible title and long desc data attributes for the video area
  const projectTitle = p.title || (p.titleKey ? strings[p.titleKey] : '')
  const projectLong = p.long_description || p.longDescription || ''
  card.setAttribute('data-title', projectTitle)
  card.setAttribute('data-long', projectLong)

  const title = document.createElement('h3')
  if (p.titleKey) { title.setAttribute('data-i18n', p.titleKey); title.textContent = strings[p.titleKey] || p.titleKey || 'Project' }
  else { title.textContent = p.title || p.titleKey || 'Project' }

  const desc = document.createElement('p')
  if (p.descKey) { desc.setAttribute('data-i18n', p.descKey); desc.textContent = strings[p.descKey] || p.descKey || '' }
  else { desc.textContent = p.short_description || p.descKey || '' }

  // NOTE: No 'view_demo' hint shown on project tiles per UI update

  card.appendChild(title)
  card.appendChild(desc)

  // optional role & technologies
  if (p.role) {
    const role = document.createElement('div'); role.className = 'project-role'; role.textContent = p.role; card.appendChild(role)
  }
  if (p.technologies && Array.isArray(p.technologies)) {
    const techList = document.createElement('div'); techList.className = 'project-tech';
    p.technologies.forEach(t => { const el = document.createElement('span'); el.className = 'tech-chip'; el.textContent = t; techList.appendChild(el) })
    card.appendChild(techList)
  }
  // hint element removed — do not append
  // set thumbnail if available
  if (p.image) {
    card.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.22)), url('${p.image}')`
    card.style.backgroundSize = 'cover'
    card.style.backgroundPosition = 'center'
    card.setAttribute('data-image', p.image)
  }
  const titleTxt = title ? title.textContent : projectTitle || 'Project'
  card.setAttribute('aria-label', titleTxt)
  return card
}

function renderProjects() {
  const grid = document.querySelector('.projects-grid')
  grid.innerHTML = ''
  const elements = projects.map((p, idx) => buildProjectCard(p, idx))
  elements.forEach(el => grid.appendChild(el))

  // attach click and keyboard handlers to project cards now that they are rendered
  const cards = Array.from(grid.querySelectorAll('.project-card'))
  cards.forEach(c => {
    c.addEventListener('click', () => { console.debug('card click', c.getAttribute('data-project-id') || c.getAttribute('data-video-id')); activateCard(c) })
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); activateCard(c) } })
  })

  // event delegation fallback - if a nested element is clicked and the one we attached to isn't fired,
  // ensure the click still activates the card by listening on the grid parent.
  // avoid adding multiple duplicate listeners when renderProjects() is called repeatedly
  if (!grid.dataset.delegated) {
    grid.addEventListener('click', (ev) => {
      const clickedCard = ev.target.closest && ev.target.closest('.project-card')
      if (clickedCard) {
        console.debug('grid delegated click ->', clickedCard.getAttribute('data-project-id') || clickedCard.getAttribute('data-video-id'))
        activateCard(clickedCard)
      }
    })
    grid.dataset.delegated = '1'
  }
  // select the first project card so showcase always has a visible project
  if (cards.length) {
    // select the first and set the video if available
    selectProject(cards[0], false)
    const firstVid = cards[0].getAttribute('data-video-id') || cards[0].getAttribute('data-youtube') || cards[0].getAttribute('data-demo-link')
    if (firstVid) setVideo(firstVid, settings.defaultAutoplay)
  }
}

// Helper to select project cards on the page
const projectCards = () => Array.from(document.querySelectorAll('.project-card'))

// Set the iframe to YouTube or arbitrary URL; also update active card state and selected info
function setVideo(id, autoplay = false) {
  const iframe = document.getElementById('ytFrame')
  console.debug('setVideo called with id:', id, 'autoplay:', autoplay)
  if (!id) { if (iframe) iframe.setAttribute('src', ''); return }
  let url = id
  // Determine whether we should embed this id/url in an iframe or treat it as external
  let useIframe = true
  if (!id.startsWith('http')) {
    url = `https://www.youtube.com/embed/${id}?rel=0&autoplay=${autoplay ? 1 : 0}`
    useIframe = true
  } else {
    // parse URL and detect known embeddable hosts (youtube/vimeo). If not, we'll not embed external site.
    try {
      const u = new URL(id)
      const host = (u.hostname || '').toLowerCase()
      console.debug('setVideo parsed host:', host)
      if (host.includes('youtube.com') || host.includes('youtu.be') || host.includes('vimeo.com') || host.includes('player.vimeo.com') || ALLOWED_EMBED_HOSTS.has(host)) {
        useIframe = true
      } else {
        useIframe = false
      }
    } catch (err) {
      useIframe = false
    }
  // ensure iframe is used for embeddable hosts; otherwise, clear it and show the project's image if present
  const projectImg = document.getElementById('projectImg')
  if (!useIframe) {
    if (iframe) iframe.setAttribute('src', '')
    if (projectImg) {
      // show placeholder image for the currently selected card
      const selected = document.querySelector('.project-card.active')
      const imgSrc = selected && selected.getAttribute('data-image')
      if (imgSrc) {
        projectImg.setAttribute('src', imgSrc)
        projectImg.classList.remove('hidden')
      } else {
        projectImg.classList.add('hidden')
      }
    }
  } else {
    if (projectImg) { projectImg.setAttribute('src', ''); projectImg.classList.add('hidden') }
    if (iframe) {
      // Add a short timeout to detect embed failures (e.g., blocked by X-Frame-Options).
      let iframeLoaded = false
      const onLoad = () => { iframeLoaded = true; iframe.removeEventListener('load', onLoad); iframe.removeEventListener('error', onError); console.debug('iframe loaded', url) }
      const onError = () => { iframeLoaded = false; iframe.removeEventListener('load', onLoad); iframe.removeEventListener('error', onError); console.warn('iframe error', url) }
      iframe.addEventListener('load', onLoad)
      iframe.addEventListener('error', onError)
      iframe.setAttribute('src', url)
      // After a short timeout, if not loaded and the content is external (http) then fallback to demo link or image.
      setTimeout(() => {
        if (!iframeLoaded && id.startsWith('http') && !hostIncludesYouTube(id)) {
          console.warn('iframe failed to load or blocked; falling back to demo link for', id)
          // hide iframe and show project image or demo link
          iframe.setAttribute('src', '')
          if (projectImg && projectImg.getAttribute('src')) { projectImg.classList.remove('hidden') }
          const demoEl = document.getElementById('projectDemoLink')
          // Only show the demo link for the Kronos project (non-embeddable external demos are hidden by default)
          if (demoEl) {
            const matchingCard = document.querySelector(`.project-card[data-demo-link="${id}"]`)
            let showDemo = false
            if (matchingCard) {
              const pid = matchingCard.getAttribute('data-project-id') || ''
              if (pid === 'kronos_live') showDemo = true
              else {
                try { const u = new URL(id); if (u.hostname.includes('kronos-live.pages.dev')) showDemo = true } catch (err) {}
              }
            }
            if (showDemo) { demoEl.classList.remove('hidden'); demoEl.focus({ preventScroll: true }) }
          }
        }
      }, 1600)
    }
    }
  projectCards().forEach(c => {
    const isMatch = c.getAttribute('data-video-id') === id || c.getAttribute('data-demo-link') === id || c.getAttribute('data-youtube') === id
    if (isMatch) {
      c.classList.add('active')
      c.setAttribute('aria-pressed', 'true')
    } else {
      c.classList.remove('active')
      c.setAttribute('aria-pressed', 'false')
    }
  })
  // update selected project title & description area
  const selected = document.querySelector('.project-card.active')
  if (selected) {
    const selTitle = document.querySelector('.selected-project-title')
    const selDesc = document.querySelector('.selected-project-desc')
    const t = selected.getAttribute('data-title') || ''
    const d = selected.getAttribute('data-long') || ''
    if (selTitle) selTitle.textContent = t
    if (selDesc) selDesc.textContent = d
    // update the demo link (if present)
    const demoLinkEl = document.getElementById('projectDemoLink')
    if (demoLinkEl) {
      const projectDemoUrl = selected.getAttribute('data-demo-link') || ''
      const projectId = selected.getAttribute('data-project-id') || ''
      let showDemo = false
      if (projectDemoUrl) {
        try {
          const u = new URL(projectDemoUrl)
          if (projectId === 'kronos_live' || u.hostname.includes('kronos-live.pages.dev')) showDemo = true
        } catch (err) {
          if (projectId === 'kronos_live') showDemo = true
        }
      }
      if (showDemo) {
        demoLinkEl.setAttribute('href', projectDemoUrl)
        // prefer Kronos to use the main CTA button style
        demoLinkEl.classList.remove('selected-project-cta')
        demoLinkEl.classList.add('cta-btn')
        demoLinkEl.classList.remove('hidden')
        demoLinkEl.textContent = strings['open_demo'] || strings['view_demo'] || 'Open demo'
      } else {
        demoLinkEl.setAttribute('href', '')
        demoLinkEl.classList.remove('cta-btn')
        demoLinkEl.classList.add('selected-project-cta')
        demoLinkEl.classList.add('hidden')
        demoLinkEl.textContent = ''
      }
    }
  }
}
}

// human-friendly label for external demo links
function friendlyLabelForUrl(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    return (u.hostname || url).replace(/^www\./, '')
  } catch (err) {
    // not a full URL; fallback to the raw string
    return url
  }
}

// Activate the card and set the video or demo link as appropriate
function activateCard(card) {
  let vid = card.getAttribute('data-video-id')
  console.debug('activateCard:', { project: card.getAttribute('data-project-id'), videoId: vid, youtube: card.getAttribute('data-youtube'), demo: card.getAttribute('data-demo-link') })
  if (!vid) vid = card.getAttribute('data-youtube') || ''
  // When the user interacts with the project (click/keyboard), scroll the showcase
  selectProject(card, true)
  if (!vid) {
    const demoUrl = card.getAttribute('data-demo-link') || ''
    if (demoUrl) vid = demoUrl
    else return setVideo('', false)
  }
  const autoplay = settings.defaultAutoplay || false
  setVideo(vid, autoplay)
}

// Update the showcase for a selected project card (title/desc/cta/image)
function selectProject(card, scroll = false) {
  if (!card) return
  // optional scroll parameter: second argument can be a boolean 'scroll'. Default to false to avoid
  // scrolling when projects are programmatically (re)rendered or when language changes.
  // parameter 'scroll' (boolean) indicates whether to scroll the showcase into view
  projectCards().forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false') })
  card.classList.add('active'); card.setAttribute('aria-pressed', 'true')
  const selTitle = document.querySelector('.selected-project-title')
  const selDesc = document.querySelector('.selected-project-desc')
  const t = card.getAttribute('data-title') || ''
  const d = card.getAttribute('data-long') || ''
  if (selTitle) selTitle.textContent = t
  if (selDesc) selDesc.textContent = d
  const demoLinkEl = document.getElementById('projectDemoLink')
  if (demoLinkEl) {
    const projectDemoUrl = card.getAttribute('data-demo-link') || ''
    const projectId = card.getAttribute('data-project-id') || ''
    let showDemo = false
    if (projectDemoUrl) {
      try {
        const u = new URL(projectDemoUrl)
        if (projectId === 'kronos_live' || u.hostname.includes('kronos-live.pages.dev')) showDemo = true
      } catch (err) {
        if (projectId === 'kronos_live') showDemo = true
      }
    }
    if (showDemo) {
      demoLinkEl.setAttribute('href', projectDemoUrl)
      // For specific projects like kronos_live, use primary CTA styling (same as CV button)
      demoLinkEl.classList.remove('selected-project-cta')
      demoLinkEl.classList.add('cta-btn')
      demoLinkEl.classList.remove('hidden')
      // If demo is an external url, show its hostname (e.g. kronos-live.pages.dev)
      // This makes it explicit that clicking will open an external page
      const friendly = friendlyLabelForUrl(projectDemoUrl)
      // prefer to show just the hostname, otherwise fallback to the i18n label
      demoLinkEl.textContent = friendly || strings['open_demo'] || strings['view_demo'] || 'Open demo'
    } else {
      demoLinkEl.setAttribute('href', '')
      demoLinkEl.classList.add('hidden')
      demoLinkEl.textContent = ''
    }
  }
  const iframeEl = document.getElementById('ytFrame')
  const projectImg = document.getElementById('projectImg')
  const imgSrc = card.getAttribute('data-image') || ''
  const vid = card.getAttribute('data-video-id') || card.getAttribute('data-youtube') || card.getAttribute('data-demo-link') || ''
  if (!vid && imgSrc) {
    if (iframeEl) iframeEl.setAttribute('src', '')
    if (projectImg) {
      projectImg.setAttribute('src', imgSrc)
      projectImg.classList.remove('hidden')
    }
  } else {
    if (projectImg) { projectImg.setAttribute('src', ''); projectImg.classList.add('hidden') }
  }
  // Scroll and focus only when explicitly requested (e.g., user click/keyboard interaction)
  if (scroll) {
    const showcase = document.querySelector('.showcase-wrapper')
    if (showcase) {
      try { showcase.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch (err) { showcase.scrollIntoView() }
      // for accessibility focus on the main element inside the showcase
      const focusable = document.getElementById('projectDemoLink') || document.getElementById('ytFrame')
      if (focusable) focusable.focus({ preventScroll: true })
    }
  }
}

function replacePlaceholders(obj, profile) {
  if (!obj) return obj
  if (typeof obj === 'string') {
    return obj.replace(/{{\s*([^}]+)\s*}}/g, (_, k) => {
      const key = k.trim()
      switch (key) {
        case 'full_name_from_external_file': return profile.fullName || ''
        case 'email_from_external_file': return profile.email || ''
        case 'phone_from_external_file': return profile.phone || ''
        default: return profile[key] || ''
      }
    })
  }
  if (Array.isArray(obj)) {
    return obj.map(v => replacePlaceholders(v, profile))
  }
  if (typeof obj === 'object') {
    const out = {}
    for (const k in obj) { out[k] = replacePlaceholders(obj[k], profile) }
    return out
  }
  return obj
}

// Helpers to set CV href and ensure a sensible filename with a .pdf extension
function safeFileNameFromUrl(href) {
  if (!href) return 'cv.pdf'
  try {
    const u = new URL(href, window.location.href)
    let name = (u.pathname || '').split('/').filter(Boolean).pop() || ''
    if (!name) name = 'cv.pdf'
    if (!name.toLowerCase().endsWith('.pdf')) name = `${name}.pdf`
    return name
  } catch (err) {
    // fallback: try to parse simple strings
    const parts = href.split('/')
    let name = parts[parts.length - 1] || 'cv.pdf'
    if (!name.toLowerCase().endsWith('.pdf')) name = `${name}.pdf`
    return name
  }
}

function setCvLink(href) {
  const el = document.getElementById('cvDownload')
  if (!el || !href) return
  el.setAttribute('href', href)
  // set the download attribute with a sensible filename
  el.setAttribute('download', safeFileNameFromUrl(href))
  // set MIME type hint (helps some browsers)
  try { el.setAttribute('type', 'application/pdf') } catch (err) {}
}

// Trigger a download for a given href; if the href is cross-origin, attempt to fetch the file
// and create a blob link to force the browser to save it with a filename.
async function triggerDownloadForHref(href) {
  if (!href) return
  try {
    const u = new URL(href, window.location.href)
    if (u.origin !== window.location.origin) {
      // cross-origin: use fetch to get blob and force download
      const resp = await fetch(href, { cache: 'no-cache', mode: 'cors' })
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const blob = await resp.blob()
      const blobUrl = URL.createObjectURL(blob)
      const temp = document.createElement('a')
      temp.href = blobUrl
      temp.setAttribute('download', safeFileNameFromUrl(href))
      document.body.appendChild(temp)
      temp.click()
      document.body.removeChild(temp)
      URL.revokeObjectURL(blobUrl)
    } else {
      // same-origin: let the browser handle download (preserves default behavior)
      window.location.href = href
    }
  } catch (err) {
    // fallback: open in new tab so user can still access the file
    console.debug('triggerDownloadForHref error, falling back to open:', err)
    window.open(href, '_blank')
  }
}

async function loadSettingsAndContent() {
  const s = await loadJson('settings.json')
  settings = { ...DEFAULT_SETTINGS, ...(s || {}) }

  const savedLang = localStorage.getItem('lang') || settings.defaultLanguage
  const contentPath = `content/${savedLang}.json`
  let c = await loadJson(contentPath)
  if (!c) {
    c = await loadJson(TEMPLATE_PATH)
  }
  strings = c || {}

  // load profile (sensitive data separated), but do not override content fields unless missing
  const prof = await loadJson('profile.json')
  profile = prof || {}
  if (profile.firstName) document.documentElement.dataset.firstName = profile.firstName
  if (profile.lastName) document.documentElement.dataset.lastName = profile.lastName

  // set document title if defined
  if (profile.fullName) { document.title = `${profile.fullName} — Portfolio` }

  // set CV link if content doesn't provide a language-specific link
  const cvEl = document.getElementById('cvDownload')
  if (!strings.download_cv_links && profile.cvFile && cvEl) {
    setCvLink(profile.cvFile)
  }

  // set alt text for logo and profile pic
  if (profile.fullName) {
    const logo = document.querySelector('.logo')
    if (logo) logo.setAttribute('alt', profile.fullName)
    const pic = document.querySelector('.profile-pic')
    if (pic) pic.setAttribute('alt', profile.fullName)
  }

  // projects from projects.json fallback
  const p = await loadJson('projects.json')
  projects = Array.isArray(p) ? p : []
  if (!projects.length) {
    // fallback to template items
    projects = [
      { id: 'sample1', videoId: '', titleKey: 'proj1_title', descKey: 'proj1_desc' },
      { id: 'sample2', videoId: '', titleKey: 'proj2_title', descKey: 'proj2_desc' }
    ]
  }

  // If content includes projects array, prefer it (and substitute placeholders)
  if (strings && Array.isArray(strings.projects) && strings.projects.length) {
    projects = replacePlaceholders(strings.projects, profile)
  }

  // Apply placeholder substitution for all strings with profile data
  strings = replacePlaceholders(strings, profile)
  // fallback alias: some content uses download_cv_text, template uses download_cv
  if (!strings.download_cv && strings.download_cv_text) strings.download_cv = strings.download_cv_text
  if (!strings.name && profile && profile.fullName) strings.name = profile.fullName
}

async function init() {
  await loadSettingsAndContent()

  // apply theme
  const savedTheme = localStorage.getItem('theme') || settings.defaultTheme
  applyTheme(savedTheme)

  // populate language switch — supports both select and flag buttons
  const langSwitch = document.querySelector('.lang-switch')
  const savedLang = localStorage.getItem('lang') || settings.defaultLanguage

  async function applyLanguageChange(v) {
    localStorage.setItem('lang', v)
    // reload content for the new language and rerender
    let c = await loadJson(`content/${v}.json`)
    if (!c) c = await loadJson(TEMPLATE_PATH)
    strings = c || {}
    strings = replacePlaceholders(strings, profile)
    // alias fallback keys
    if (!strings.download_cv && strings.download_cv_text) strings.download_cv = strings.download_cv_text
    if (!strings.name && profile && profile.fullName) strings.name = profile.fullName
    // if the content provides projects, reassign
    if (strings && Array.isArray(strings.projects) && strings.projects.length) { projects = replacePlaceholders(strings.projects, profile) }
    updateTextNodes()
    updateProjectLabels()
    renderHero()
    renderSkills()
    renderExperience()
    renderEducation()
    renderLanguages()
    renderContact()
    renderProjects()
    const brand = document.getElementById('brandLink')
    if (brand && profile && profile.fullName) { brand.setAttribute('aria-label', `Go to homepage — ${profile.fullName}`) }
    // update buttons/select state to reflect the newly selected language
    if (langSwitch) {
      const select = langSwitch.querySelector('select')
      if (select) select.value = v
      const btns = langSwitch.querySelectorAll('.lang-btn')
      if (btns && btns.length) btns.forEach(b => b.setAttribute('aria-pressed', b.getAttribute('data-lang') === v ? 'true' : 'false'))
    }
  }

  // If the lang-switch contains a <select> element, preserve existing UX; otherwise wire up flag buttons.
  if (langSwitch) {
    const select = langSwitch.querySelector('select')
    if (select) {
      select.value = savedLang
      select.addEventListener('change', async e => await applyLanguageChange(e.target.value))
    } else {
      const btns = langSwitch.querySelectorAll('.lang-btn')
      Array.from(btns).forEach(b => {
        const lang = b.getAttribute('data-lang')
        b.setAttribute('aria-pressed', lang === savedLang ? 'true' : 'false')
        b.addEventListener('click', async (e) => {
          btns.forEach(x => x.setAttribute('aria-pressed', 'false'))
          b.setAttribute('aria-pressed', 'true')
          await applyLanguageChange(lang)
        })
      })
    }
  }

  // theme toggle
  const themeToggle = document.getElementById('themeToggle')
  themeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark')
    if (isDark) {
      document.documentElement.classList.remove('light')
      themeToggle.textContent = '🌙'
      themeToggle.setAttribute('aria-pressed', 'true')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.add('light')
      themeToggle.textContent = '☀️'
      themeToggle.setAttribute('aria-pressed', 'false')
      localStorage.setItem('theme', 'light')
    }
    // add small animation to the icon to make the change more meaningful
    themeToggle.classList.add('theme-toggle-anim')
    setTimeout(() => themeToggle.classList.remove('theme-toggle-anim'), 380)
  })

  // initial render
  updateTextNodes()
  renderHero()
  renderSkills()
  renderExperience()
  renderEducation()
  renderLanguages()
  renderContact()
  renderProjects()
  // renderRepos removed - we rely on profile.github link and projects list

  // brand link behavior - prevent full reload and scroll to top
  const brand = document.getElementById('brandLink')
  if (brand) {
    brand.addEventListener('click', (e) => {
      e.preventDefault()
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
    })
    if (profile.fullName) {
      brand.setAttribute('aria-label', `Go to homepage — ${profile.fullName}`)
    }
  }




  // helper to update project node text and aria on language change
  function updateProjectLabels() {
    projectCards().forEach(card => {
      const titleEl = card.querySelector('h3')
      const descEl = card.querySelector('p')
      const titleKey = titleEl && titleEl.getAttribute('data-i18n')
      const descKey = descEl && descEl.getAttribute('data-i18n')
      if (titleKey) titleEl.textContent = strings[titleKey] || titleKey
      if (descKey) descEl.textContent = strings[descKey] || descKey
      // 'view_demo' hint removed from project tiles — no hint text to update
      const titleTxt = titleEl ? titleEl.textContent : 'Project'
      card.setAttribute('aria-label', titleTxt)
    })
    // update demo link text if visible — only show for Kronos
    const demoLinkEl = document.getElementById('projectDemoLink')
    if (demoLinkEl) {
      const active = document.querySelector('.project-card.active')
      const activeDemo = active && active.getAttribute('data-demo-link')
      let showDemo = false
      if (active && activeDemo) {
        const pid = active.getAttribute('data-project-id') || ''
        try {
          const u = new URL(activeDemo)
          if (pid === 'kronos_live' || u.hostname.includes('kronos-live.pages.dev')) showDemo = true
        } catch (err) {
          if (pid === 'kronos_live') showDemo = true
        }
      }
      if (showDemo) {
        demoLinkEl.textContent = friendlyLabelForUrl(activeDemo) || strings['open_demo'] || strings['view_demo'] || 'Open demo'
        demoLinkEl.classList.remove('hidden')
        demoLinkEl.classList.remove('selected-project-cta')
        demoLinkEl.classList.add('cta-btn')
      } else {
        demoLinkEl.textContent = ''
        demoLinkEl.classList.remove('cta-btn')
        demoLinkEl.classList.add('selected-project-cta')
        demoLinkEl.classList.add('hidden')
      }
    }
  }

  // Render dynamic sections based on loaded content strings and profile
  function renderHero() {
    const heroTitle = document.querySelector('.hero-title')
    const heroSub = document.querySelector('.hero-sub')
    const profilePic = document.querySelector('.profile-card .profile-pic')
    const cta = document.getElementById('cvDownload')
    if (strings.hero_title) heroTitle.textContent = strings.hero_title
    if (strings.hero_subtitle) heroSub.textContent = strings.hero_subtitle
    // set profile image in profile card (prefer content, otherwise use profile.json or fallback)
    const FALLBACK_AVATAR = 'https://avatars.githubusercontent.com/u/149014250'
    const picSrc = strings.profile_photo || profile.profile_photo || FALLBACK_AVATAR
    if (picSrc && profilePic) {
      profilePic.setAttribute('src', picSrc)
      // If a relative or absolute profile image 404s, fall back to GitHub avatar
      profilePic.onerror = () => { profilePic.onerror = null; profilePic.setAttribute('src', FALLBACK_AVATAR) }
    }
    // prefer content-provided CV links; otherwise fallback to profile.cvFile
    const lang = localStorage.getItem('lang') || settings.defaultLanguage
    if (strings.download_cv_links && strings.download_cv_links[lang]) {
      setCvLink(strings.download_cv_links[lang])
    } else if (profile && profile.cvFile) {
      setCvLink(profile.cvFile)
    }
  }

  function renderSkills() {
    const list = document.querySelector('.skills-list')
    list.innerHTML = ''
    const arr = strings.skills || []
    arr.forEach(s => {
      const el = document.createElement('div'); el.className = 'skills-chip'; el.textContent = s.name || s; list.appendChild(el)
    })
  }

  function renderExperience() {
    const list = document.querySelector('.experience-list'); list.innerHTML = ''
    const arr = strings.experience || []
    arr.forEach(x => { const el = document.createElement('div'); el.className = 'exp-card'; el.innerHTML = `<strong>${x.role || x.title || ''}</strong><div>${x.company || ''}</div><p>${x.description || ''}</p>`; list.appendChild(el) })
  }

  function renderEducation() {
    const list = document.querySelector('.education-list'); list.innerHTML = ''
    const arr = strings.education || []
    arr.forEach(e => { const el = document.createElement('div'); el.className = 'edu-card'; el.innerHTML = `<strong>${e.school || ''}</strong><div>${e.degree || ''} ${e.start_date || ''} ${e.end_date || ''}</div><p>${e.description || ''}</p>`; list.appendChild(el) })
  }

  function renderLanguages() {
    const list = document.querySelector('.languages-list'); list.innerHTML = ''
    const arr = strings.languages || []
    arr.forEach(l => { const el = document.createElement('div'); el.className = 'language-pill'; el.textContent = `${l.language} — ${l.level}`; list.appendChild(el) })
  }

  function renderContact() {
    const box = document.querySelector('.contact-box'); box.innerHTML = ''
    const c = strings.contact || {}
    // prefer profile.json values for contact details when available
    const email = profile.email || c.email || ''
    const phone = profile.phone || c.phone || ''
    const github = profile.github || c.github_url || ''
    const website = profile.website || c.website_url || c.website || ''
    if (email) box.insertAdjacentHTML('beforeend', `<div>Email: <a href='mailto:${email}'>${email}</a></div>`)
    if (phone) box.insertAdjacentHTML('beforeend', `<div>Phone: ${phone}</div>`)
    if (github) box.insertAdjacentHTML('beforeend', `<div>Github: <a target='_blank' rel='noopener noreferrer' href='${github}'>${github}</a></div>`)
    if (website) box.insertAdjacentHTML('beforeend', `<div>Website: <a target='_blank' rel='noopener noreferrer' href='${website}'>${website}</a></div>`)
  }

  // renderRepos removed: Repositories are not displayed as a separate section. We keep the GitHub link in profile/contact

  // default to first project
  // default to first project (if renderProjects didn't set it already)
  const firstCard = document.querySelector('.project-card')
  if (firstCard && !document.querySelector('.project-card.active')) {
    selectProject(firstCard, false)
    const firstVid = firstCard.getAttribute('data-video-id') || firstCard.getAttribute('data-youtube') || firstCard.getAttribute('data-demo-link')
    if (firstVid) setVideo(firstVid, settings.defaultAutoplay)
  }

  // CV button animation and download behavior: target the specific CV anchor
  const ctaButton = document.getElementById('cvDownload')
  if (ctaButton) {
    const animate = (e) => {
      // add active state
      ctaButton.classList.add('active')
      // remove the active state after a short interval
      setTimeout(() => ctaButton.classList.remove('active'), 550)
    }
    ctaButton.addEventListener('click', async (e) => {
      animate()
      try {
        const href = ctaButton.getAttribute('href')
        if (!href) return
        const u = new URL(href, window.location.href)
        if (u.origin !== window.location.origin) {
          e.preventDefault()
          await triggerDownloadForHref(href)
        }
      } catch (err) {
        // if URL parsing fails, do nothing and let default behavior happen
      }
    })
    ctaButton.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        animate()
        // use our helper to trigger download with proper filename handling
        setTimeout(() => { triggerDownloadForHref(ctaButton.getAttribute('href')) }, 120)
      }
    })
  }

  // ensure year is set
  const yearEl = document.getElementById('year')
  if (yearEl) yearEl.textContent = new Date().getFullYear()
}

// When the DOM is ready, keep a loading state until our init completes.
document.addEventListener('DOMContentLoaded', async () => {
  // ensure a11y state
  document.body.setAttribute('aria-busy', 'true')
  document.body.classList.add('is-loading')
  try {
    await init()
  } finally {
    // hide loader and reveal site after render
    const loader = document.getElementById('site-loader')
    if (loader) { loader.classList.add('hidden'); setTimeout(() => loader.remove(), 360) }
    document.body.classList.remove('is-loading')
    document.body.removeAttribute('aria-busy')
  }
})