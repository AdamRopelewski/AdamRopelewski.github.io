/*
  App loader that fetches settings, localized content, and projects.
  - settings.json (defaultLanguage, defaultTheme, defaultAutoplay)
  - content/<lang>.json for localized strings; fallback to content/template.json
  - projects.json with array of projects: {id, videoId, titleKey, descKey}

  The script will dynamically render the project cards and wire up
  event handlers for language/theme toggles and video swaps.
*/

// helper to fetch and parse JSON with fallback
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
  const videoId = p.videoId || p.youtube_id || p.youtubeId || ''
  card.setAttribute('data-video-id', videoId)
  if (p.youtube_embed && p.youtube_embed.includes('{{id}}') && p.youtube_id) {
    card.setAttribute('data-youtube', p.youtube_embed.replace('{{id}}', p.youtube_id))
  } else if (p.youtube_embed && !p.youtube_embed.includes('{{id}}')) {
    card.setAttribute('data-youtube', p.youtube_embed)
  }
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

  const hint = document.createElement('span')
  hint.className = 'hint'
  hint.setAttribute('data-i18n', 'view_demo')
  hint.textContent = strings['view_demo'] || 'Click to view demo'

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
  card.appendChild(hint)
  // set thumbnail if available
  if (p.image) {
    card.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.22)), url('${p.image}')`
    card.style.backgroundSize = 'cover'
    card.style.backgroundPosition = 'center'
  }
  const titleTxt = title ? title.textContent : projectTitle || 'Project'
  card.setAttribute('aria-label', `${titleTxt}: ${strings['view_demo'] || 'Click to view demo'}`)
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
    c.addEventListener('click', () => activateCard(c))
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); activateCard(c) } })
  })
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
  const cvEl = document.querySelectorAll('.cv-btn')
  if (!strings.download_cv_links && profile.cvFile) {
    cvEl.forEach(el => el.setAttribute('href', profile.cvFile))
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

  // populate selects
  const langSelect = document.getElementById('langSelect')
  langSelect.value = localStorage.getItem('lang') || settings.defaultLanguage
  langSelect.addEventListener('change', async e => {
    const v = e.target.value
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
  })

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


  // set event handlers for cards are added in renderProjects() for each card
  const iframe = document.getElementById('ytFrame')

  const projectCards = () => Array.from(document.querySelectorAll('.project-card'))
  function setVideo(id, autoplay = false) {
    if (!id) { iframe.setAttribute('src', ''); return }
    // id may be a full URL or a raw id
    let url = id
    if (!id.startsWith('http')) {
      url = `https://www.youtube.com/embed/${id}?rel=0&autoplay=${autoplay ? 1 : 0}`
    }
    iframe.setAttribute('src', url)
    projectCards().forEach(c => {
      if (c.getAttribute('data-video-id') === id) {
        c.classList.add('active');
        c.setAttribute('aria-pressed', 'true')
      } else {
        c.classList.remove('active');
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
    }
  }

  function activateCard(card) {
    let vid = card.getAttribute('data-video-id')
    // try to read a youtube id from dataset or from project structure in case we're using content projects
    if (!vid) {
      // try to find an injected property from content data: data-youtube
      vid = card.getAttribute('data-youtube') || ''
    }
    if (!vid) return setVideo('', false)
    const autoplay = settings.defaultAutoplay || false
    setVideo(vid, autoplay)
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
      card.querySelector('.hint').textContent = strings['view_demo'] || 'Click to view demo'
      const titleTxt = titleEl ? titleEl.textContent : 'Project'
      card.setAttribute('aria-label', `${titleTxt}: ${strings['view_demo'] || 'Click to view demo'}`)
    })
  }

  // Render dynamic sections based on loaded content strings and profile
  function renderHero() {
    const heroTitle = document.querySelector('.hero-title')
    const heroSub = document.querySelector('.hero-sub')
    const profilePic = document.querySelector('.profile-card .profile-pic')
    const cta = document.querySelector('.hero-cta .cv-btn')
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
      cta.setAttribute('href', strings.download_cv_links[lang])
    } else if (profile && profile.cvFile) {
      cta.setAttribute('href', profile.cvFile)
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
  const firstCard = document.querySelector('.project-card')
  if (firstCard) {
    const firstVid = firstCard.getAttribute('data-video-id') || firstCard.getAttribute('data-youtube')
    if (firstVid) setVideo(firstVid, settings.defaultAutoplay)
  }

  // CV button animation: add 'active' class briefly on click (or keyboard activation)
  const cvButton = document.querySelector('.cv-btn')
  if (cvButton) {
    const animate = (e) => {
      // add active state
      cvButton.classList.add('active')
      // remove the active state after a short interval
      setTimeout(() => cvButton.classList.remove('active'), 550)
    }
    cvButton.addEventListener('click', animate)
    cvButton.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        animate()
        // allow default anchor behavior to continue after animation
        setTimeout(() => { window.location.href = cvButton.getAttribute('href') }, 120)
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
