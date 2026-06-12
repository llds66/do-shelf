export const CONCISE_MODE_CLASS = 'do-shelf-concise-mode'

export const conciseModeStyles = `
html.${CONCISE_MODE_CLASS} .drop-down-mode.d-header-wrap {
  display: none !important;
}

html.${CONCISE_MODE_CLASS} .welcome-banner.--location-above-topic-content {
  display: none !important;
}

html.${CONCISE_MODE_CLASS} #main-container {
  display: none !important;
}

html.${CONCISE_MODE_CLASS} .btn.btn-icon-text.btn-default.sidebar__panel-switch-button {
  display: none !important;
}

html.${CONCISE_MODE_CLASS} div[data-section-name="资源"].sidebar-section.sidebar-section-wrapper.sidebar-section--expanded {
  display: none !important;
}

html.${CONCISE_MODE_CLASS} #sidebar-section-content-community li[data-list-item-name="upcoming-events"]  {
  display: none !important;
}

html.${CONCISE_MODE_CLASS} #sidebar-section-content-community li[data-list-item-name="ai-bot"]  {
  display: none !important;
}
`.trim()

export const pageEnhancementStyleText = [conciseModeStyles].join('\n\n')
