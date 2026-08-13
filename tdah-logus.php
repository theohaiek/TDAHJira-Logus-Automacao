<?php
/**
 * Plugin Name: TDAH Jira — Logus
 * Description: Gerenciador de tarefas visual: a simplicidade de uma planilha com a rastreabilidade de um issue tracker. Feito para quem executa bem quando o trabalho está claramente colocado.
 * Version:     1.0.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Text Domain: tdah-logus
 *
 * Este arquivo fica na raiz do repositório de propósito: assim a mesma pasta
 * funciona como plugin do WordPress (basta clonar dentro de wp-content/plugins)
 * e como aplicação autônoma servida pelo Node, sem etapa de empacotamento e
 * sem duplicar o front-end.
 *
 * A interface em /web e o contrato da API são os mesmos nos dois modos. O que
 * muda é apenas quem responde: aqui, o WordPress; lá, /server.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('TDAH_LOGUS_VERSION', '1.0.0');
define('TDAH_LOGUS_FILE', __FILE__);
define('TDAH_LOGUS_DIR', plugin_dir_path(__FILE__));
define('TDAH_LOGUS_URL', plugin_dir_url(__FILE__));
define('TDAH_LOGUS_NS', 'tdah-logus/v1');

require_once TDAH_LOGUS_DIR . 'wordpress/includes/class-schema.php';
require_once TDAH_LOGUS_DIR . 'wordpress/includes/class-db.php';
require_once TDAH_LOGUS_DIR . 'wordpress/includes/class-events.php';
require_once TDAH_LOGUS_DIR . 'wordpress/includes/class-tasks.php';
require_once TDAH_LOGUS_DIR . 'wordpress/includes/class-comments.php';
require_once TDAH_LOGUS_DIR . 'wordpress/includes/class-uploads.php';
require_once TDAH_LOGUS_DIR . 'wordpress/includes/class-rest.php';
require_once TDAH_LOGUS_DIR . 'wordpress/includes/class-admin.php';

register_activation_hook(__FILE__, ['TDAH_Logus_Schema', 'install']);

add_action('plugins_loaded', function () {
    // Uma atualização do plugin pode trazer tabela nova; verificar aqui evita
    // depender de alguém reativar o plugin à mão.
    TDAH_Logus_Schema::maybe_upgrade();
});

add_action('rest_api_init', ['TDAH_Logus_Rest', 'register_routes']);
add_action('admin_menu', ['TDAH_Logus_Admin', 'menu']);
add_action('admin_enqueue_scripts', ['TDAH_Logus_Admin', 'assets']);
