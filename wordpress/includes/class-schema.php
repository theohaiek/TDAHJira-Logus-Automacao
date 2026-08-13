<?php
/**
 * Criação das tabelas no MySQL.
 *
 * É a tradução de core/schema.sql para o dialeto que o WordPress usa. Se um
 * campo mudar lá, muda aqui — os dois arquivos descrevem o mesmo desenho.
 *
 * Diferença deliberada em relação ao modo autônomo: aqui não existe tabela de
 * pessoas nem de sessões. Quem já tem WordPress já tem contas e login; criar
 * um segundo cadastro seria pedir que o time gerencie senha duas vezes.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TDAH_Logus_Schema
{
    const OPTION_VERSION = 'tdah_logus_db_version';
    const DB_VERSION     = '1.0.0';

    public static function table($nome)
    {
        global $wpdb;
        return $wpdb->prefix . 'tdah_' . $nome;
    }

    public static function install()
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $charset = $wpdb->get_charset_collate();
        $p       = $wpdb->prefix . 'tdah_';

        // dbDelta é exigente com o formato: duas espaços após PRIMARY KEY,
        // uma definição por linha e KEY em vez de INDEX.
        $sql = [];

        $sql[] = "CREATE TABLE {$p}projects (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  proj_key varchar(12) NOT NULL,
  name varchar(160) NOT NULL,
  color varchar(9) NOT NULL DEFAULT '#a2e4f0',
  description text NOT NULL,
  position int(11) NOT NULL DEFAULT 0,
  is_archived tinyint(1) NOT NULL DEFAULT 0,
  seq int(11) NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY proj_key (proj_key)
) $charset;";

        $sql[] = "CREATE TABLE {$p}tasks (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  project_id bigint(20) unsigned DEFAULT NULL,
  number int(11) DEFAULT NULL,
  title varchar(500) NOT NULL,
  description longtext NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'inbox',
  priority varchar(20) NOT NULL DEFAULT 'normal',
  energy varchar(20) DEFAULT NULL,
  size int(11) DEFAULT NULL,
  assignee_id bigint(20) unsigned DEFAULT NULL,
  reporter_id bigint(20) unsigned DEFAULT NULL,
  parent_id bigint(20) unsigned DEFAULT NULL,
  due_on date DEFAULT NULL,
  focus_on date DEFAULT NULL,
  waiting_for varchar(200) DEFAULT NULL,
  position double NOT NULL DEFAULT 0,
  is_archived tinyint(1) NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  started_at datetime DEFAULT NULL,
  done_at datetime DEFAULT NULL,
  status_since datetime NOT NULL,
  touched_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY status (status,is_archived),
  KEY assignee_id (assignee_id,status),
  KEY project_id (project_id,status),
  KEY parent_id (parent_id),
  KEY focus_on (focus_on),
  KEY due_on (due_on)
) $charset;";

        $sql[] = "CREATE TABLE {$p}steps (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  task_id bigint(20) unsigned NOT NULL,
  text varchar(300) NOT NULL,
  is_done tinyint(1) NOT NULL DEFAULT 0,
  position double NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  done_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY task_id (task_id,position)
) $charset;";

        $sql[] = "CREATE TABLE {$p}labels (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  name varchar(60) NOT NULL,
  color varchar(9) NOT NULL DEFAULT '#8fa9b5',
  PRIMARY KEY  (id),
  UNIQUE KEY name (name)
) $charset;";

        $sql[] = "CREATE TABLE {$p}task_labels (
  task_id bigint(20) unsigned NOT NULL,
  label_id bigint(20) unsigned NOT NULL,
  PRIMARY KEY  (task_id,label_id),
  KEY label_id (label_id)
) $charset;";

        $sql[] = "CREATE TABLE {$p}comments (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  task_id bigint(20) unsigned NOT NULL,
  author_id bigint(20) unsigned DEFAULT NULL,
  body longtext NOT NULL,
  created_at datetime NOT NULL,
  updated_at datetime DEFAULT NULL,
  edited tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  KEY task_id (task_id,created_at)
) $charset;";

        $sql[] = "CREATE TABLE {$p}attachments (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  task_id bigint(20) unsigned NOT NULL,
  comment_id bigint(20) unsigned DEFAULT NULL,
  uploader_id bigint(20) unsigned DEFAULT NULL,
  original_name varchar(200) NOT NULL,
  stored_name varchar(120) NOT NULL,
  mime varchar(100) NOT NULL,
  size_bytes bigint(20) unsigned NOT NULL,
  width int(11) DEFAULT NULL,
  height int(11) DEFAULT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY stored_name (stored_name),
  KEY task_id (task_id),
  KEY comment_id (comment_id)
) $charset;";

        $sql[] = "CREATE TABLE {$p}events (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  task_id bigint(20) unsigned DEFAULT NULL,
  actor_id bigint(20) unsigned DEFAULT NULL,
  kind varchar(40) NOT NULL,
  field varchar(40) DEFAULT NULL,
  from_value text DEFAULT NULL,
  to_value text DEFAULT NULL,
  note text DEFAULT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY task_id (task_id,id),
  KEY created_at (created_at),
  KEY kind (kind,created_at)
) $charset;";

        $sql[] = "CREATE TABLE {$p}focus_sessions (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  task_id bigint(20) unsigned DEFAULT NULL,
  user_id bigint(20) unsigned NOT NULL,
  started_at datetime NOT NULL,
  ended_at datetime DEFAULT NULL,
  seconds int(11) NOT NULL DEFAULT 0,
  planned_min int(11) NOT NULL DEFAULT 25,
  completed tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  KEY user_id (user_id,started_at),
  KEY task_id (task_id)
) $charset;";

        foreach ($sql as $ddl) {
            dbDelta($ddl);
        }

        self::protect_uploads();
        update_option(self::OPTION_VERSION, self::DB_VERSION);
    }

    public static function maybe_upgrade()
    {
        if (get_option(self::OPTION_VERSION) !== self::DB_VERSION) {
            self::install();
        }
    }

    /**
     * A pasta de anexos não pode ser navegável pela web: os arquivos saem
     * sempre pela rota da API, que confere a sessão antes de entregar.
     */
    public static function protect_uploads()
    {
        $dir = TDAH_Logus_Uploads::dir();
        if (!file_exists($dir)) {
            wp_mkdir_p($dir);
        }
        $htaccess = trailingslashit($dir) . '.htaccess';
        if (!file_exists($htaccess)) {
            file_put_contents($htaccess, "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
        }
        $index = trailingslashit($dir) . 'index.php';
        if (!file_exists($index)) {
            file_put_contents($index, "<?php\n// Silêncio.\n");
        }
    }
}
