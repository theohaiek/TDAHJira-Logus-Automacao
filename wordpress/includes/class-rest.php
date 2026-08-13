<?php
/**
 * Rotas REST.
 *
 * O contrato é o mesmo de server/api.js, documentado em docs/API.md. O front
 * não sabe qual dos dois backends está atendendo: a única diferença é o
 * prefixo da URL, que chega pronto em window.TDAH_BOOT.apiBase.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TDAH_Logus_Rest
{
    /**
     * Quem pode usar: qualquer pessoa autenticada no WordPress com permissão
     * de leitura. Um time de três pessoas não precisa de matriz de papéis;
     * a distinção que existe é apenas administrador ou não.
     */
    public static function pode()
    {
        if (!is_user_logged_in()) {
            return TDAH_Logus_DB::error('Sessão expirada ou inexistente.', 401);
        }
        if (!current_user_can('read')) {
            return TDAH_Logus_DB::error('Sem permissão.', 403);
        }
        return true;
    }

    public static function register_routes()
    {
        $ns = TDAH_LOGUS_NS;
        $p  = ['permission_callback' => [self::class, 'pode']];

        $rota = function ($caminho, $metodos, $callback) use ($ns, $p) {
            register_rest_route($ns, $caminho, array_merge($p, [
                'methods'  => $metodos,
                'callback' => $callback,
            ]));
        };

        // /boot é a única rota aberta. O front pergunta por ela antes de saber
        // se existe sessão — exatamente como faz no modo autônomo. Exigir login
        // aqui deixaria a interface sem resposta para "estou autenticado?".
        register_rest_route($ns, '/boot', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'boot'],
            'permission_callback' => '__return_true',
        ]);

        // Estado e sincronização
        $rota('/state', 'GET', [self::class, 'state']);
        $rota('/sync', 'GET', [self::class, 'sync']);
        $rota('/activity', 'GET', [self::class, 'activity']);

        // Tarefas
        $rota('/tasks', 'GET', [self::class, 'listar_tarefas']);
        $rota('/tasks', 'POST', [self::class, 'criar_tarefa']);
        $rota('/tasks/(?P<id>\d+)', 'GET', [self::class, 'obter_tarefa']);
        $rota('/tasks/(?P<id>\d+)', 'PATCH', [self::class, 'atualizar_tarefa']);
        $rota('/tasks/(?P<id>\d+)', 'DELETE', [self::class, 'apagar_tarefa']);
        $rota('/tasks/(?P<id>\d+)/move', 'POST', [self::class, 'mover_tarefa']);
        $rota('/tasks/(?P<id>\d+)/timeline', 'GET', [self::class, 'timeline']);

        // Passos
        $rota('/tasks/(?P<id>\d+)/steps', 'POST', [self::class, 'criar_passo']);
        $rota('/tasks/(?P<id>\d+)/steps/(?P<step>\d+)', 'PATCH', [self::class, 'alternar_passo']);
        $rota('/tasks/(?P<id>\d+)/steps/(?P<step>\d+)', 'DELETE', [self::class, 'remover_passo']);

        // Conversa
        $rota('/tasks/(?P<id>\d+)/comments', 'GET', [self::class, 'listar_comentarios']);
        $rota('/tasks/(?P<id>\d+)/comments', 'POST', [self::class, 'criar_comentario']);
        $rota('/comments/(?P<id>\d+)', 'PATCH', [self::class, 'editar_comentario']);
        $rota('/comments/(?P<id>\d+)', 'DELETE', [self::class, 'apagar_comentario']);

        // Anexos
        $rota('/tasks/(?P<id>\d+)/attachments', 'POST', [self::class, 'enviar_anexo']);
        $rota('/attachments/(?P<id>\d+)', 'GET', [self::class, 'baixar_anexo']);
        $rota('/attachments/(?P<id>\d+)', 'DELETE', [self::class, 'apagar_anexo']);

        // Projetos e etiquetas
        $rota('/projects', 'GET', [self::class, 'listar_projetos']);
        $rota('/projects', 'POST', [self::class, 'criar_projeto']);
        $rota('/projects/(?P<id>\d+)', 'PATCH', [self::class, 'atualizar_projeto']);
        $rota('/labels', 'GET', [self::class, 'listar_etiquetas']);
        $rota('/labels', 'POST', [self::class, 'criar_etiqueta']);
        $rota('/labels/(?P<id>\d+)', 'DELETE', [self::class, 'apagar_etiqueta']);

        // Pessoas e preferências
        $rota('/users', 'GET', [self::class, 'listar_usuarios']);
        $rota('/me/prefs', 'PATCH', [self::class, 'salvar_prefs']);

        // Foco
        $rota('/focus', 'GET', [self::class, 'foco_hoje']);
        $rota('/focus/start', 'POST', [self::class, 'foco_iniciar']);
        $rota('/focus/stop', 'POST', [self::class, 'foco_parar']);
    }

    // --- Estado ------------------------------------------------------------

    public static function boot()
    {
        return [
            'app'           => 'TDAH Jira — Logus',
            'mode'          => 'wordpress',
            'version'       => TDAH_LOGUS_VERSION,
            'authenticated' => is_user_logged_in(),
            'user'          => TDAH_Logus_DB::usuario_publico(wp_get_current_user()),
            'vocabulary'    => [
                'statuses'   => TDAH_Logus_Tasks::STATUSES,
                'priorities' => TDAH_Logus_Tasks::PRIORITIES,
                'energies'   => TDAH_Logus_Tasks::ENERGIES,
            ],
            'limits' => ['maxUpload' => TDAH_Logus_Uploads::MAX_UPLOAD],
        ];
    }

    public static function state()
    {
        return [
            'cursor'   => TDAH_Logus_Events::cursor(),
            'today'    => TDAH_Logus_DB::today(),
            'me'       => TDAH_Logus_DB::usuario_publico(wp_get_current_user()),
            'prefs'    => self::prefs(),
            'users'    => TDAH_Logus_DB::usuarios(),
            'projects' => self::projetos(),
            'labels'   => self::etiquetas(),
            'tasks'    => TDAH_Logus_Tasks::listar(),
            'activity' => TDAH_Logus_Events::recent(50),
        ];
    }

    public static function sync(WP_REST_Request $req)
    {
        global $wpdb;

        $de    = (int) $req->get_param('cursor');
        $agora = TDAH_Logus_Events::cursor();

        if ($agora === $de) {
            return ['cursor' => $agora, 'tasks' => [], 'events' => []];
        }

        $ids = TDAH_Logus_Events::changed_since($de);
        $tarefas = TDAH_Logus_Tasks::por_ids($ids);

        $existentes = array_map(function ($t) { return $t['id']; }, $tarefas);
        $removidas  = array_values(array_diff($ids, $existentes));

        return [
            'cursor'  => $agora,
            'tasks'   => $tarefas,
            'removed' => $removidas,
            'events'  => TDAH_Logus_Events::recent(40),
        ];
    }

    public static function activity(WP_REST_Request $req)
    {
        $limite = (int) $req->get_param('limit');
        return ['activity' => TDAH_Logus_Events::recent($limite ? $limite : 60)];
    }

    // --- Tarefas -----------------------------------------------------------

    public static function listar_tarefas(WP_REST_Request $req)
    {
        return ['tasks' => TDAH_Logus_Tasks::listar($req->get_param('archived') === '1')];
    }

    public static function criar_tarefa(WP_REST_Request $req)
    {
        $t = TDAH_Logus_Tasks::criar((array) $req->get_json_params());
        if (is_wp_error($t)) {
            return $t;
        }
        return new WP_REST_Response(['task' => $t], 201);
    }

    public static function obter_tarefa(WP_REST_Request $req)
    {
        $id = (int) $req['id'];
        $t  = TDAH_Logus_Tasks::uma($id);
        if (!$t) {
            return TDAH_Logus_DB::error('Tarefa não encontrada.', 404);
        }
        return [
            'task'        => $t,
            'comments'    => TDAH_Logus_Comments::listar($id),
            'attachments' => TDAH_Logus_Uploads::listar($id),
            'timeline'    => TDAH_Logus_Events::timeline($id),
        ];
    }

    public static function atualizar_tarefa(WP_REST_Request $req)
    {
        $id    = (int) $req['id'];
        $corpo = (array) $req->get_json_params();

        if (isset($corpo['labels']) && is_array($corpo['labels'])) {
            TDAH_Logus_Tasks::definir_etiquetas($id, $corpo['labels']);
        }

        $t = TDAH_Logus_Tasks::atualizar($id, $corpo);
        if (is_wp_error($t)) {
            return $t;
        }
        return ['task' => $t];
    }

    public static function apagar_tarefa(WP_REST_Request $req)
    {
        if (!current_user_can('manage_options')) {
            return TDAH_Logus_DB::error('Apenas administradores apagam tarefas.', 403);
        }
        TDAH_Logus_Tasks::apagar((int) $req['id']);
        return ['ok' => true];
    }

    public static function mover_tarefa(WP_REST_Request $req)
    {
        $t = TDAH_Logus_Tasks::mover((int) $req['id'], (array) $req->get_json_params());
        if (is_wp_error($t)) {
            return $t;
        }
        return ['task' => $t];
    }

    public static function timeline(WP_REST_Request $req)
    {
        return ['timeline' => TDAH_Logus_Events::timeline((int) $req['id'])];
    }

    // --- Passos ------------------------------------------------------------

    public static function criar_passo(WP_REST_Request $req)
    {
        $id    = (int) $req['id'];
        $corpo = (array) $req->get_json_params();
        $r     = TDAH_Logus_Tasks::adicionar_passo($id, isset($corpo['text']) ? $corpo['text'] : '');
        if (is_wp_error($r)) {
            return $r;
        }
        return new WP_REST_Response(['task' => TDAH_Logus_Tasks::uma($id)], 201);
    }

    public static function alternar_passo(WP_REST_Request $req)
    {
        $corpo = (array) $req->get_json_params();
        $r = TDAH_Logus_Tasks::alternar_passo((int) $req['step'], !empty($corpo['done']));
        if (is_wp_error($r)) {
            return $r;
        }
        return ['task' => TDAH_Logus_Tasks::uma((int) $req['id'])];
    }

    public static function remover_passo(WP_REST_Request $req)
    {
        TDAH_Logus_Tasks::remover_passo((int) $req['step']);
        return ['task' => TDAH_Logus_Tasks::uma((int) $req['id'])];
    }

    // --- Conversa ----------------------------------------------------------

    public static function listar_comentarios(WP_REST_Request $req)
    {
        return ['comments' => TDAH_Logus_Comments::listar((int) $req['id'])];
    }

    public static function criar_comentario(WP_REST_Request $req)
    {
        $id    = (int) $req['id'];
        $corpo = (array) $req->get_json_params();
        $r     = TDAH_Logus_Comments::adicionar($id, isset($corpo['body']) ? $corpo['body'] : '');
        if (is_wp_error($r)) {
            return $r;
        }
        return new WP_REST_Response([
            'comments' => TDAH_Logus_Comments::listar($id),
            'task'     => TDAH_Logus_Tasks::uma($id),
            'timeline' => TDAH_Logus_Events::timeline($id),
        ], 201);
    }

    public static function editar_comentario(WP_REST_Request $req)
    {
        $corpo = (array) $req->get_json_params();
        $task_id = TDAH_Logus_Comments::editar((int) $req['id'], isset($corpo['body']) ? $corpo['body'] : '');
        if (is_wp_error($task_id)) {
            return $task_id;
        }
        return ['comments' => TDAH_Logus_Comments::listar($task_id)];
    }

    public static function apagar_comentario(WP_REST_Request $req)
    {
        $task_id = TDAH_Logus_Comments::apagar((int) $req['id']);
        if (is_wp_error($task_id)) {
            return $task_id;
        }
        return ['comments' => $task_id ? TDAH_Logus_Comments::listar($task_id) : []];
    }

    // --- Anexos ------------------------------------------------------------

    /**
     * O arquivo chega como corpo binário puro, com o nome num cabeçalho.
     * Sem multipart: é menos código dos dois lados e uma superfície de erro
     * a menos.
     */
    public static function enviar_anexo(WP_REST_Request $req)
    {
        $id   = (int) $req['id'];
        $mime = strtok((string) $req->get_header('content-type'), ';');
        $mime = trim($mime);

        $nome = $req->get_header('x-file-name');
        $nome = $nome ? rawurldecode($nome) : 'anexo';

        $comment_id = $req->get_header('x-comment-id');
        $conteudo   = $req->get_body();

        $a = TDAH_Logus_Uploads::salvar($id, $comment_id ? (int) $comment_id : null, $conteudo, $mime, $nome);
        if (is_wp_error($a)) {
            return $a;
        }
        return new WP_REST_Response([
            'attachment' => $a,
            'task'       => TDAH_Logus_Tasks::uma($id),
        ], 201);
    }

    public static function baixar_anexo(WP_REST_Request $req)
    {
        $a = TDAH_Logus_Uploads::obter_interno((int) $req['id']);
        if (!$a) {
            return TDAH_Logus_DB::error('Anexo não encontrado.', 404);
        }

        $caminho = trailingslashit(TDAH_Logus_Uploads::dir()) . basename($a['storedName']);
        if (!file_exists($caminho)) {
            return TDAH_Logus_DB::error('Arquivo ausente no disco.', 404);
        }

        $disposicao = TDAH_Logus_Uploads::inline($a['mime']) ? 'inline' : 'attachment';

        // Entrega direta: o corpo é o arquivo, não JSON.
        header('Content-Type: ' . $a['mime']);
        header('Content-Length: ' . $a['size']);
        header('X-Content-Type-Options: nosniff');
        header('Content-Disposition: ' . $disposicao . "; filename*=UTF-8''" . rawurlencode($a['name']));
        header('Cache-Control: private, max-age=86400');
        readfile($caminho);
        exit;
    }

    public static function apagar_anexo(WP_REST_Request $req)
    {
        $r = TDAH_Logus_Uploads::apagar((int) $req['id']);
        if (is_wp_error($r)) {
            return $r;
        }
        return ['ok' => true];
    }

    // --- Projetos e etiquetas ----------------------------------------------

    private static function projetos()
    {
        global $wpdb;
        $tp = TDAH_Logus_Schema::table('projects');
        $linhas = $wpdb->get_results("SELECT * FROM $tp WHERE is_archived = 0 ORDER BY position, id");

        return array_map(function ($p) {
            return [
                'id'          => (int) $p->id,
                'key'         => $p->proj_key,
                'name'        => $p->name,
                'color'       => $p->color,
                'description' => $p->description,
                'position'    => (int) $p->position,
            ];
        }, $linhas);
    }

    private static function etiquetas()
    {
        global $wpdb;
        $tl = TDAH_Logus_Schema::table('labels');
        $linhas = $wpdb->get_results("SELECT * FROM $tl ORDER BY name");
        return array_map(function ($l) {
            return ['id' => (int) $l->id, 'name' => $l->name, 'color' => $l->color];
        }, $linhas);
    }

    public static function listar_projetos()
    {
        return ['projects' => self::projetos()];
    }

    public static function criar_projeto(WP_REST_Request $req)
    {
        global $wpdb;
        $corpo = (array) $req->get_json_params();

        $nome = trim((string) (isset($corpo['name']) ? $corpo['name'] : ''));
        if ($nome === '') {
            return TDAH_Logus_DB::error('O projeto precisa de um nome.');
        }

        $base = preg_replace('/[^A-Z0-9]/', '', strtoupper(isset($corpo['key']) && $corpo['key'] ? $corpo['key'] : $nome));
        $base = substr($base, 0, 6);
        if ($base === '') {
            $base = 'PRJ';
        }

        $tp    = TDAH_Logus_Schema::table('projects');
        $final = $base;
        $n     = 2;
        while ($wpdb->get_var($wpdb->prepare("SELECT id FROM $tp WHERE proj_key = %s", $final))) {
            $final = $base . $n;
            $n++;
        }

        $agora = TDAH_Logus_DB::now();
        $wpdb->insert($tp, [
            'proj_key'    => $final,
            'name'        => mb_substr($nome, 0, 120),
            'color'       => isset($corpo['color']) ? substr((string) $corpo['color'], 0, 9) : '#a2e4f0',
            'description' => isset($corpo['description']) ? mb_substr((string) $corpo['description'], 0, 500) : '',
            'position'    => isset($corpo['position']) ? (int) $corpo['position'] : 0,
            'created_at'  => $agora,
            'updated_at'  => $agora,
        ]);

        $id = (int) $wpdb->insert_id;
        $p  = $wpdb->get_row($wpdb->prepare("SELECT * FROM $tp WHERE id = %d", $id));

        return new WP_REST_Response([
            'project' => [
                'id'          => $id,
                'key'         => $p->proj_key,
                'name'        => $p->name,
                'color'       => $p->color,
                'description' => $p->description,
                'position'    => (int) $p->position,
            ],
        ], 201);
    }

    public static function atualizar_projeto(WP_REST_Request $req)
    {
        global $wpdb;
        $id    = (int) $req['id'];
        $corpo = (array) $req->get_json_params();
        $tp    = TDAH_Logus_Schema::table('projects');

        $p = $wpdb->get_row($wpdb->prepare("SELECT * FROM $tp WHERE id = %d", $id));
        if (!$p) {
            return TDAH_Logus_DB::error('Projeto não encontrado.', 404);
        }

        $wpdb->update($tp, [
            'name'        => isset($corpo['name']) ? mb_substr((string) $corpo['name'], 0, 120) : $p->name,
            'color'       => isset($corpo['color']) ? substr((string) $corpo['color'], 0, 9) : $p->color,
            'description' => isset($corpo['description']) ? mb_substr((string) $corpo['description'], 0, 500) : $p->description,
            'is_archived' => isset($corpo['archived']) ? TDAH_Logus_DB::bool($corpo['archived']) : $p->is_archived,
            'updated_at'  => TDAH_Logus_DB::now(),
        ], ['id' => $id]);

        // Devolve o projeto inteiro, e não só o id: é o que o modo autônomo
        // faz, e o front usa a resposta para atualizar a barra lateral.
        $p = $wpdb->get_row($wpdb->prepare("SELECT * FROM $tp WHERE id = %d", $id));

        return ['project' => [
            'id'          => $id,
            'key'         => $p->proj_key,
            'name'        => $p->name,
            'color'       => $p->color,
            'description' => $p->description,
            'position'    => (int) $p->position,
        ]];
    }

    public static function listar_etiquetas()
    {
        return ['labels' => self::etiquetas()];
    }

    public static function criar_etiqueta(WP_REST_Request $req)
    {
        global $wpdb;
        $corpo = (array) $req->get_json_params();
        $nome  = mb_substr(trim((string) (isset($corpo['name']) ? $corpo['name'] : '')), 0, 40);

        if ($nome === '') {
            return TDAH_Logus_DB::error('A etiqueta precisa de um nome.');
        }

        $tl = TDAH_Logus_Schema::table('labels');
        $ja = $wpdb->get_row($wpdb->prepare("SELECT * FROM $tl WHERE LOWER(name) = LOWER(%s)", $nome));
        if ($ja) {
            return ['label' => ['id' => (int) $ja->id, 'name' => $ja->name, 'color' => $ja->color]];
        }

        $wpdb->insert($tl, [
            'name'  => $nome,
            'color' => isset($corpo['color']) ? substr((string) $corpo['color'], 0, 9) : '#8fa9b5',
        ]);

        return new WP_REST_Response([
            'label' => [
                'id'    => (int) $wpdb->insert_id,
                'name'  => $nome,
                'color' => isset($corpo['color']) ? substr((string) $corpo['color'], 0, 9) : '#8fa9b5',
            ],
        ], 201);
    }

    public static function apagar_etiqueta(WP_REST_Request $req)
    {
        global $wpdb;
        $id = (int) $req['id'];
        $wpdb->delete(TDAH_Logus_Schema::table('task_labels'), ['label_id' => $id]);
        $wpdb->delete(TDAH_Logus_Schema::table('labels'), ['id' => $id]);
        return ['ok' => true];
    }

    // --- Pessoas e preferências --------------------------------------------

    public static function listar_usuarios()
    {
        return ['users' => TDAH_Logus_DB::usuarios()];
    }

    private static function prefs()
    {
        $p = get_user_meta(get_current_user_id(), 'tdah_logus_prefs', true);
        return is_array($p) ? $p : [];
    }

    public static function salvar_prefs(WP_REST_Request $req)
    {
        $atual = self::prefs();
        $novo  = array_merge($atual, (array) $req->get_json_params());
        update_user_meta(get_current_user_id(), 'tdah_logus_prefs', $novo);
        return ['prefs' => $novo];
    }

    // --- Foco ---------------------------------------------------------------

    public static function foco_iniciar(WP_REST_Request $req)
    {
        global $wpdb;
        $corpo = (array) $req->get_json_params();
        $tf    = TDAH_Logus_Schema::table('focus_sessions');
        $uid   = get_current_user_id();

        $wpdb->query($wpdb->prepare(
            "UPDATE $tf SET ended_at = %s, completed = 0 WHERE user_id = %d AND ended_at IS NULL",
            TDAH_Logus_DB::now(), $uid
        ));

        $wpdb->insert($tf, [
            'task_id'     => !empty($corpo['taskId']) ? (int) $corpo['taskId'] : null,
            'user_id'     => $uid,
            'started_at'  => TDAH_Logus_DB::now(),
            'planned_min' => !empty($corpo['minutes']) ? (int) $corpo['minutes'] : 25,
        ]);

        return new WP_REST_Response(['session' => ['id' => (int) $wpdb->insert_id]], 201);
    }

    public static function foco_parar(WP_REST_Request $req)
    {
        global $wpdb;
        $corpo = (array) $req->get_json_params();
        $tf    = TDAH_Logus_Schema::table('focus_sessions');
        $uid   = get_current_user_id();

        $aberta = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $tf WHERE user_id = %d AND ended_at IS NULL ORDER BY id DESC LIMIT 1", $uid
        ));

        if ($aberta) {
            $segundos = max(0, time() - strtotime($aberta->started_at . ' UTC'));
            $wpdb->update($tf, [
                'ended_at'  => TDAH_Logus_DB::now(),
                'seconds'   => $segundos,
                'completed' => !empty($corpo['completed']) ? 1 : 0,
            ], ['id' => (int) $aberta->id]);
        }

        return ['ok' => true];
    }

    public static function foco_hoje()
    {
        global $wpdb;
        $tf  = TDAH_Logus_Schema::table('focus_sessions');
        $uid = get_current_user_id();

        $linha = $wpdb->get_row($wpdb->prepare(
            "SELECT COALESCE(SUM(seconds), 0) AS s, COUNT(*) AS n
               FROM $tf
              WHERE user_id = %d AND completed = 1 AND DATE(started_at) = %s",
            $uid, gmdate('Y-m-d')
        ), ARRAY_A);

        return ['today' => ['s' => (int) $linha['s'], 'n' => (int) $linha['n']]];
    }
}
