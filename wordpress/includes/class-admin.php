<?php
/**
 * A tela dentro do painel do WordPress.
 *
 * A aplicação ocupa a área de conteúdo inteira, sem cabeçalho de página nem
 * caixas do WordPress em volta: a interface já tem a própria navegação, e
 * duas navegações empilhadas confundem mais do que ajudam.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TDAH_Logus_Admin
{
    const SLUG = 'tdah-logus';

    public static function menu()
    {
        add_menu_page(
            'TDAH Jira',
            'TDAH Jira',
            'read',
            self::SLUG,
            [self::class, 'render'],
            'dashicons-yes-alt',
            3
        );
    }

    public static function assets($hook)
    {
        if ($hook !== 'toplevel_page_' . self::SLUG) {
            return;
        }

        $v = TDAH_LOGUS_VERSION;

        wp_enqueue_style('tdah-logus-tokens', TDAH_LOGUS_URL . 'web/css/tokens.css', [], $v);
        wp_enqueue_style('tdah-logus-base', TDAH_LOGUS_URL . 'web/css/base.css', ['tdah-logus-tokens'], $v);
        wp_enqueue_style('tdah-logus-app', TDAH_LOGUS_URL . 'web/css/app.css', ['tdah-logus-base'], $v);
        wp_enqueue_style('tdah-logus-wp', TDAH_LOGUS_URL . 'wordpress/assets/admin.css', ['tdah-logus-app'], $v);

        // O front é um módulo ES nativo. Sem etapa de compilação: o que está
        // no repositório é exatamente o que o navegador executa.
        wp_enqueue_script('tdah-logus-app', TDAH_LOGUS_URL . 'web/js/app.js', [], $v, true);
        wp_script_add_data('tdah-logus-app', 'type', 'module');

        wp_add_inline_script(
            'tdah-logus-app',
            'window.TDAH_BOOT = ' . wp_json_encode([
                'apiBase' => esc_url_raw(rest_url(TDAH_LOGUS_NS . '/')),
                'nonce'   => wp_create_nonce('wp_rest'),
                'mode'    => 'wordpress',
                'assets'  => TDAH_LOGUS_URL . 'web/',
            ]) . ';',
            'before'
        );
    }

    public static function render()
    {
        // A estrutura precisa ser a mesma de web/index.html: é o mesmo
        // JavaScript que vai procurar estes elementos.
        ?>
        <div class="wrap tdah-logus-wrap" data-theme="dark">
          <div id="login" hidden></div>

          <div id="app" class="app" hidden>
            <aside class="rail" id="rail">
              <a class="rail__brand" href="#/hoje">
                <span class="mark" aria-hidden="true"></span>
                <span class="rail__brandtext">
                  <strong>Logus</strong>
                  <small>Soluções em Automação</small>
                </span>
              </a>
              <nav class="rail__nav" id="nav" aria-label="Seções"></nav>
              <div class="rail__projects">
                <div class="rail__heading">
                  <span>Projetos</span>
                  <button class="icon-btn icon-btn--tiny" id="new-project" aria-label="Novo projeto">+</button>
                </div>
                <div id="project-list"></div>
              </div>
              <div class="rail__foot">
                <button class="rail__user" id="user-btn">
                  <span class="avatar" id="user-avatar"></span>
                  <span class="rail__username" id="user-name"></span>
                </button>
              </div>
            </aside>

            <div class="main">
              <header class="topbar">
                <button class="icon-btn topbar__menu" id="rail-toggle" aria-label="Menu">&#9776;</button>
                <div class="capture">
                  <input id="capture" class="capture__input" placeholder="O que precisa ser feito?  (n)"
                         autocomplete="off" spellcheck="false" aria-label="Captura rápida de tarefa" />
                  <div class="capture__hint" id="capture-hint" hidden></div>
                </div>
                <div class="topbar__actions">
                  <button class="icon-btn" id="cmd-btn" aria-label="Comandos">&#8981;</button>
                  <button class="icon-btn" id="theme-btn" aria-label="Alternar tema">&#9686;</button>
                  <button class="icon-btn" id="calm-btn" aria-label="Modo calmo">&#9671;</button>
                </div>
              </header>
              <main class="view" id="view" tabindex="-1"></main>
            </div>
          </div>

          <div class="drawer" id="drawer" hidden>
            <div class="drawer__scrim" data-close></div>
            <section class="drawer__panel" role="dialog" aria-modal="true" aria-label="Detalhes da tarefa">
              <div id="drawer-body"></div>
            </section>
          </div>

          <div class="focus" id="focus" hidden></div>

          <div class="palette" id="palette" hidden>
            <div class="palette__scrim" data-close></div>
            <div class="palette__box" role="dialog" aria-modal="true" aria-label="Comandos">
              <input id="palette-input" class="palette__input" placeholder="Buscar tarefa ou comando…" autocomplete="off" />
              <div id="palette-results" class="palette__results"></div>
            </div>
          </div>

          <div class="toasts" id="toasts" aria-live="polite"></div>
          <div class="celebrate" id="celebrate" aria-hidden="true"></div>
        </div>
        <?php
    }
}
