<?php
/**
 * Regras de tarefa. Espelho de server/tasks.js — mesmos campos, mesmos
 * eventos, mesma forma de saída.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TDAH_Logus_Tasks
{
    const STATUSES   = ['inbox', 'todo', 'doing', 'waiting', 'done'];
    const PRIORITIES = ['agora', 'normal', 'quando_der'];
    const ENERGIES   = ['leve', 'media', 'pesada'];

    /** Campo da API => [coluna, tipo, aceita nulo] */
    private static function campos()
    {
        return [
            'title'       => ['title', 'text', false],
            'description' => ['description', 'text', false],
            'status'      => ['status', 'enum:' . implode(',', self::STATUSES), false],
            'priority'    => ['priority', 'enum:' . implode(',', self::PRIORITIES), false],
            'energy'      => ['energy', 'enum:' . implode(',', self::ENERGIES), true],
            'size'        => ['size', 'int', true],
            'assigneeId'  => ['assignee_id', 'int', true],
            'projectId'   => ['project_id', 'int', true],
            'parentId'    => ['parent_id', 'int', true],
            'dueOn'       => ['due_on', 'date', true],
            'focusOn'     => ['focus_on', 'date', true],
            'waitingFor'  => ['waiting_for', 'text', true],
            'position'    => ['position', 'float', false],
            'archived'    => ['is_archived', 'bool', false],
        ];
    }

    private static function evento_de()
    {
        return [
            'title' => 'title', 'description' => 'description', 'status' => 'status',
            'priority' => 'priority', 'energy' => 'energy', 'size' => 'size',
            'assigneeId' => 'assignee', 'projectId' => 'project', 'parentId' => 'parent',
            'dueOn' => 'due', 'focusOn' => 'focus', 'waitingFor' => 'waiting',
            'archived' => 'archived',
        ];
    }

    // --- Leitura -----------------------------------------------------------

    public static function listar($incluir_arquivadas = false)
    {
        global $wpdb;
        $t = TDAH_Logus_Schema::table('tasks');
        $p = TDAH_Logus_Schema::table('projects');

        $where = $incluir_arquivadas ? '' : 'WHERE t.is_archived = 0';
        $linhas = $wpdb->get_results(
            "SELECT t.*, p.proj_key AS project_key, p.color AS project_color, p.name AS project_name
               FROM $t t LEFT JOIN $p p ON p.id = t.project_id
               $where
              ORDER BY t.position, t.id"
        );

        return self::decorar($linhas);
    }

    public static function por_ids($ids)
    {
        global $wpdb;
        $ids = array_values(array_filter(array_map('intval', (array) $ids)));
        if (empty($ids)) {
            return [];
        }
        $t = TDAH_Logus_Schema::table('tasks');
        $p = TDAH_Logus_Schema::table('projects');
        $marcas = implode(',', array_fill(0, count($ids), '%d'));

        $linhas = $wpdb->get_results($wpdb->prepare(
            "SELECT t.*, p.proj_key AS project_key, p.color AS project_color, p.name AS project_name
               FROM $t t LEFT JOIN $p p ON p.id = t.project_id
              WHERE t.id IN ($marcas)",
            $ids
        ));

        return self::decorar($linhas);
    }

    public static function uma($id)
    {
        $lista = self::por_ids([$id]);
        return empty($lista) ? null : $lista[0];
    }

    private static function decorar($linhas)
    {
        global $wpdb;
        if (empty($linhas)) {
            return [];
        }

        $ids    = array_map(function ($l) { return (int) $l->id; }, $linhas);
        $marcas = implode(',', array_fill(0, count($ids), '%d'));

        $ts = TDAH_Logus_Schema::table('steps');
        $tl = TDAH_Logus_Schema::table('task_labels');
        $tc = TDAH_Logus_Schema::table('comments');
        $ta = TDAH_Logus_Schema::table('attachments');

        $passos = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $ts WHERE task_id IN ($marcas) ORDER BY position, id", $ids
        ));
        $etiquetas = $wpdb->get_results($wpdb->prepare(
            "SELECT task_id, label_id FROM $tl WHERE task_id IN ($marcas)", $ids
        ));
        $comentarios = $wpdb->get_results($wpdb->prepare(
            "SELECT task_id, COUNT(*) AS n FROM $tc WHERE task_id IN ($marcas) GROUP BY task_id", $ids
        ));
        $anexos = $wpdb->get_results($wpdb->prepare(
            "SELECT task_id, COUNT(*) AS n FROM $ta WHERE task_id IN ($marcas) GROUP BY task_id", $ids
        ));

        $mapa_passos = [];
        foreach ($passos as $s) {
            $mapa_passos[(int) $s->task_id][] = [
                'id'       => (int) $s->id,
                'text'     => $s->text,
                'done'     => (bool) $s->is_done,
                'position' => (float) $s->position,
            ];
        }
        $mapa_etiquetas = [];
        foreach ($etiquetas as $l) {
            $mapa_etiquetas[(int) $l->task_id][] = (int) $l->label_id;
        }
        $mapa_comentarios = [];
        foreach ($comentarios as $c) {
            $mapa_comentarios[(int) $c->task_id] = (int) $c->n;
        }
        $mapa_anexos = [];
        foreach ($anexos as $a) {
            $mapa_anexos[(int) $a->task_id] = (int) $a->n;
        }

        $saida = [];
        foreach ($linhas as $l) {
            $id  = (int) $l->id;
            $t   = self::shape($l);
            $t['steps']           = isset($mapa_passos[$id]) ? $mapa_passos[$id] : [];
            $t['labels']          = isset($mapa_etiquetas[$id]) ? $mapa_etiquetas[$id] : [];
            $t['commentCount']    = isset($mapa_comentarios[$id]) ? $mapa_comentarios[$id] : 0;
            $t['attachmentCount'] = isset($mapa_anexos[$id]) ? $mapa_anexos[$id] : 0;
            $saida[] = $t;
        }
        return $saida;
    }

    private static function shape($l)
    {
        $chave = ($l->project_key && $l->number)
            ? $l->project_key . '-' . $l->number
            : '#' . $l->id;

        return [
            'id'           => (int) $l->id,
            'key'          => $chave,
            'number'       => TDAH_Logus_DB::int_or_null($l->number),
            'projectId'    => TDAH_Logus_DB::int_or_null($l->project_id),
            'projectKey'   => $l->project_key,
            'projectColor' => $l->project_color,
            'projectName'  => $l->project_name,
            'title'        => $l->title,
            'description'  => $l->description,
            'status'       => $l->status,
            'priority'     => $l->priority,
            'energy'       => $l->energy,
            'size'         => TDAH_Logus_DB::int_or_null($l->size),
            'assigneeId'   => TDAH_Logus_DB::int_or_null($l->assignee_id),
            'reporterId'   => TDAH_Logus_DB::int_or_null($l->reporter_id),
            'parentId'     => TDAH_Logus_DB::int_or_null($l->parent_id),
            'dueOn'        => $l->due_on,
            'focusOn'      => $l->focus_on,
            'waitingFor'   => $l->waiting_for,
            'position'     => (float) $l->position,
            'archived'     => (bool) $l->is_archived,
            'createdAt'    => TDAH_Logus_DB::iso($l->created_at),
            'updatedAt'    => TDAH_Logus_DB::iso($l->updated_at),
            'startedAt'    => TDAH_Logus_DB::iso($l->started_at),
            'doneAt'       => TDAH_Logus_DB::iso($l->done_at),
            'statusSince'  => TDAH_Logus_DB::iso($l->status_since),
            'touchedAt'    => TDAH_Logus_DB::iso($l->touched_at),
            'steps'        => [],
            'labels'       => [],
            'commentCount' => 0,
            'attachmentCount' => 0,
        ];
    }

    // --- Escrita -----------------------------------------------------------

    public static function criar($entrada)
    {
        global $wpdb;

        $titulo = trim((string) (isset($entrada['title']) ? $entrada['title'] : ''));
        if ($titulo === '') {
            return TDAH_Logus_DB::error('A tarefa precisa de um título.');
        }
        if (mb_strlen($titulo) > 500) {
            return TDAH_Logus_DB::error('Título longo demais.');
        }

        $project_id = !empty($entrada['projectId']) ? (int) $entrada['projectId'] : null;
        $numero     = null;

        if ($project_id) {
            $tp = TDAH_Logus_Schema::table('projects');
            if (!$wpdb->get_var($wpdb->prepare("SELECT id FROM $tp WHERE id = %d", $project_id))) {
                return TDAH_Logus_DB::error('Projeto inexistente.');
            }

            // Incremento atômico no próprio banco. Ler, somar em PHP e gravar
            // faria duas pessoas criando tarefas ao mesmo tempo receberem o
            // mesmo número — e a chave visível (LOG-14) deixaria de ser única.
            $wpdb->query($wpdb->prepare(
                "UPDATE $tp SET seq = seq + 1, updated_at = %s WHERE id = %d",
                TDAH_Logus_DB::now(),
                $project_id
            ));
            $numero = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT seq FROM $tp WHERE id = %d",
                $project_id
            ));
        }

        $agora  = TDAH_Logus_DB::now();
        $status = (isset($entrada['status']) && in_array($entrada['status'], self::STATUSES, true))
            ? $entrada['status'] : 'inbox';

        $dados = [
            'project_id'   => $project_id,
            'number'       => $numero,
            'title'        => $titulo,
            'description'  => isset($entrada['description']) ? (string) $entrada['description'] : '',
            'status'       => $status,
            'priority'     => (isset($entrada['priority']) && in_array($entrada['priority'], self::PRIORITIES, true))
                ? $entrada['priority'] : 'normal',
            'energy'       => (isset($entrada['energy']) && in_array($entrada['energy'], self::ENERGIES, true))
                ? $entrada['energy'] : null,
            'size'         => !empty($entrada['size']) ? max(1, min(40, (int) $entrada['size'])) : null,
            'assignee_id'  => !empty($entrada['assigneeId']) ? (int) $entrada['assigneeId'] : null,
            'reporter_id'  => get_current_user_id() ? get_current_user_id() : null,
            'parent_id'    => !empty($entrada['parentId']) ? (int) $entrada['parentId'] : null,
            'due_on'       => TDAH_Logus_DB::date_or_null(isset($entrada['dueOn']) ? $entrada['dueOn'] : null),
            'focus_on'     => TDAH_Logus_DB::date_or_null(isset($entrada['focusOn']) ? $entrada['focusOn'] : null),
            'waiting_for'  => !empty($entrada['waitingFor']) ? mb_substr((string) $entrada['waitingFor'], 0, 200) : null,
            'position'     => isset($entrada['position']) ? (float) $entrada['position'] : self::proxima_posicao($status),
            'created_at'   => $agora,
            'updated_at'   => $agora,
            'status_since' => $agora,
            'touched_at'   => $agora,
            'started_at'   => $status === 'doing' ? $agora : null,
            'done_at'      => $status === 'done' ? $agora : null,
        ];

        $wpdb->insert(TDAH_Logus_Schema::table('tasks'), $dados);
        $id = (int) $wpdb->insert_id;

        TDAH_Logus_Events::log(['task_id' => $id, 'kind' => 'created', 'to' => $titulo]);

        if (!empty($entrada['steps']) && is_array($entrada['steps'])) {
            foreach ($entrada['steps'] as $i => $texto) {
                $texto = trim((string) $texto);
                if ($texto !== '') {
                    self::adicionar_passo($id, $texto, $i * 1000);
                }
            }
        }

        return self::uma($id);
    }

    public static function atualizar($id, $patch)
    {
        global $wpdb;
        $tt = TDAH_Logus_Schema::table('tasks');

        $antes = $wpdb->get_row($wpdb->prepare("SELECT * FROM $tt WHERE id = %d", $id));
        if (!$antes) {
            return TDAH_Logus_DB::error('Tarefa não encontrada.', 404);
        }

        $set        = [];
        $mudancas   = [];
        $eventos    = self::evento_de();

        foreach (self::campos() as $chave => $spec) {
            if (!array_key_exists($chave, $patch)) {
                continue;
            }
            list($coluna, $tipo, $aceita_nulo) = $spec;

            $valor = self::converter($chave, $tipo, $aceita_nulo, $patch[$chave]);
            if (is_wp_error($valor)) {
                return $valor;
            }

            $atual = $antes->$coluna;
            if ((string) $atual === (string) $valor) {
                continue;
            }

            $set[$coluna] = $valor;
            $mudancas[]   = ['chave' => $chave, 'de' => $atual, 'para' => $valor];
        }

        if (empty($mudancas)) {
            return self::uma($id);
        }

        $agora = TDAH_Logus_DB::now();

        $mudou_status = null;
        foreach ($mudancas as $m) {
            if ($m['chave'] === 'status') {
                $mudou_status = $m;
            }
        }

        if ($mudou_status) {
            $set['status_since'] = $agora;

            if ($mudou_status['para'] === 'doing' && empty($antes->started_at)) {
                $set['started_at'] = $agora;
            }
            if ($mudou_status['para'] === 'done') {
                $set['done_at'] = $agora;
            } elseif ($antes->status === 'done') {
                $set['done_at'] = null;
            }
            // Sair de "esperando" limpa de quem se esperava.
            if ($antes->status === 'waiting' && $mudou_status['para'] !== 'waiting'
                && !array_key_exists('waitingFor', $patch)) {
                $set['waiting_for'] = null;
                if (!empty($antes->waiting_for)) {
                    $mudancas[] = ['chave' => 'waitingFor', 'de' => $antes->waiting_for, 'para' => null];
                }
            }
            // Puxar para "fazendo" é declarar que é hoje.
            if ($mudou_status['para'] === 'doing' && empty($antes->focus_on)
                && !array_key_exists('focusOn', $patch)) {
                $set['focus_on'] = TDAH_Logus_DB::today();
            }
        }

        $set['updated_at'] = $agora;
        $set['touched_at'] = $agora;

        $wpdb->update($tt, $set, ['id' => $id]);

        foreach ($mudancas as $m) {
            TDAH_Logus_Events::log([
                'task_id' => $id,
                'kind'    => isset($eventos[$m['chave']]) ? $eventos[$m['chave']] : 'update',
                'field'   => $m['chave'],
                'from'    => $m['de'],
                'to'      => $m['para'],
            ]);
        }

        return self::uma($id);
    }

    public static function mover($id, $args)
    {
        global $wpdb;
        $tt = TDAH_Logus_Schema::table('tasks');

        $status = (isset($args['status']) && in_array($args['status'], self::STATUSES, true))
            ? $args['status'] : null;

        $before_id = !empty($args['beforeId']) ? (int) $args['beforeId'] : null;
        $after_id  = !empty($args['afterId']) ? (int) $args['afterId'] : null;

        $anterior = $after_id
            ? $wpdb->get_var($wpdb->prepare("SELECT position FROM $tt WHERE id = %d", $after_id))
            : null;
        $seguinte = $before_id
            ? $wpdb->get_var($wpdb->prepare("SELECT position FROM $tt WHERE id = %d", $before_id))
            : null;

        if ($anterior !== null && $seguinte !== null) {
            $posicao = ((float) $anterior + (float) $seguinte) / 2;
        } elseif ($anterior !== null) {
            $posicao = (float) $anterior + 1024;
        } elseif ($seguinte !== null) {
            $posicao = (float) $seguinte - 1024;
        } else {
            $coluna_atual = $status
                ? $status
                : $wpdb->get_var($wpdb->prepare("SELECT status FROM $tt WHERE id = %d", $id));
            $posicao = self::proxima_posicao($coluna_atual);
        }

        $patch = ['position' => $posicao];
        if ($status) {
            $patch['status'] = $status;
        }
        return self::atualizar($id, $patch);
    }

    public static function apagar($id)
    {
        global $wpdb;
        $id = (int) $id;

        // O SQLite do modo autônomo apaga as subtarefas em cascata pela chave
        // estrangeira. Aqui não há chave estrangeira, então a cascata é feita
        // à mão — senão a subtarefa fica órfã, invisível e impossível de
        // alcançar por qualquer tela.
        $tt = TDAH_Logus_Schema::table('tasks');
        $filhos = $wpdb->get_col($wpdb->prepare("SELECT id FROM $tt WHERE parent_id = %d", $id));
        foreach ($filhos as $filho) {
            self::apagar((int) $filho);
        }

        foreach (['steps', 'comments', 'attachments', 'events', 'task_labels', 'focus_sessions'] as $tabela) {
            $wpdb->delete(TDAH_Logus_Schema::table($tabela), ['task_id' => $id]);
        }
        $wpdb->delete($tt, ['id' => $id]);
    }

    // --- Passos ------------------------------------------------------------

    public static function adicionar_passo($task_id, $texto, $posicao = null)
    {
        global $wpdb;
        $ts = TDAH_Logus_Schema::table('steps');

        $texto = trim((string) $texto);
        if ($texto === '') {
            return TDAH_Logus_DB::error('O passo precisa de um texto.');
        }

        // Sem chave estrangeira no MySQL, um passo apontando para tarefa
        // inexistente seria gravado sem reclamar e ficaria órfão para sempre.
        $tt = TDAH_Logus_Schema::table('tasks');
        if (!$wpdb->get_var($wpdb->prepare("SELECT id FROM $tt WHERE id = %d", $task_id))) {
            return TDAH_Logus_DB::error('Tarefa não encontrada.', 404);
        }

        if ($posicao === null) {
            $max = $wpdb->get_var($wpdb->prepare("SELECT MAX(position) FROM $ts WHERE task_id = %d", $task_id));
            $posicao = ((float) $max) + 1000;
        }

        $texto = mb_substr($texto, 0, 300);
        $wpdb->insert($ts, [
            'task_id'    => $task_id,
            'text'       => $texto,
            'position'   => $posicao,
            'created_at' => TDAH_Logus_DB::now(),
        ]);

        TDAH_Logus_Events::log(['task_id' => $task_id, 'kind' => 'step_add', 'to' => $texto]);
        self::tocar($task_id);
        return (int) $wpdb->insert_id;
    }

    public static function alternar_passo($step_id, $feito)
    {
        global $wpdb;
        $ts = TDAH_Logus_Schema::table('steps');

        $passo = $wpdb->get_row($wpdb->prepare("SELECT * FROM $ts WHERE id = %d", $step_id));
        if (!$passo) {
            return TDAH_Logus_DB::error('Passo não encontrado.', 404);
        }

        $wpdb->update($ts, [
            'is_done' => $feito ? 1 : 0,
            'done_at' => $feito ? TDAH_Logus_DB::now() : null,
        ], ['id' => $step_id]);

        TDAH_Logus_Events::log([
            'task_id' => (int) $passo->task_id,
            'kind'    => $feito ? 'step_done' : 'step_undone',
            'to'      => $passo->text,
        ]);
        self::tocar((int) $passo->task_id);
        return (int) $passo->task_id;
    }

    public static function remover_passo($step_id)
    {
        global $wpdb;
        $ts = TDAH_Logus_Schema::table('steps');

        $passo = $wpdb->get_row($wpdb->prepare("SELECT * FROM $ts WHERE id = %d", $step_id));
        if (!$passo) {
            return null;
        }
        $wpdb->delete($ts, ['id' => $step_id]);
        TDAH_Logus_Events::log([
            'task_id' => (int) $passo->task_id,
            'kind'    => 'step_remove',
            'from'    => $passo->text,
        ]);
        self::tocar((int) $passo->task_id);
        return (int) $passo->task_id;
    }

    // --- Etiquetas ---------------------------------------------------------

    public static function definir_etiquetas($task_id, $ids)
    {
        global $wpdb;
        $tl = TDAH_Logus_Schema::table('task_labels');

        $desejadas = array_values(array_unique(array_filter(array_map('intval', (array) $ids))));
        $atuais    = array_map('intval', $wpdb->get_col($wpdb->prepare(
            "SELECT label_id FROM $tl WHERE task_id = %d", $task_id
        )));

        foreach (array_diff($desejadas, $atuais) as $lid) {
            $wpdb->insert($tl, ['task_id' => $task_id, 'label_id' => $lid]);
            TDAH_Logus_Events::log(['task_id' => $task_id, 'kind' => 'label_add', 'to' => $lid]);
        }
        foreach (array_diff($atuais, $desejadas) as $lid) {
            $wpdb->delete($tl, ['task_id' => $task_id, 'label_id' => $lid]);
            TDAH_Logus_Events::log(['task_id' => $task_id, 'kind' => 'label_remove', 'from' => $lid]);
        }
        self::tocar($task_id);
    }

    // --- Auxiliares --------------------------------------------------------

    public static function tocar($task_id)
    {
        global $wpdb;
        $agora = TDAH_Logus_DB::now();
        $wpdb->update(
            TDAH_Logus_Schema::table('tasks'),
            ['touched_at' => $agora, 'updated_at' => $agora],
            ['id' => $task_id]
        );
    }

    private static function proxima_posicao($status)
    {
        global $wpdb;
        $tt  = TDAH_Logus_Schema::table('tasks');
        $max = $wpdb->get_var($wpdb->prepare("SELECT MAX(position) FROM $tt WHERE status = %s", $status));
        return ((float) $max) + 1024;
    }

    private static function converter($chave, $tipo, $aceita_nulo, $bruto)
    {
        $vazio = ($bruto === null || $bruto === '');

        if ($vazio) {
            if ($aceita_nulo) {
                return null;
            }
            if ($tipo === 'bool') {
                return 0;
            }
            return TDAH_Logus_DB::error("O campo $chave não pode ficar vazio.");
        }

        if (strpos($tipo, 'enum:') === 0) {
            $valores = explode(',', substr($tipo, 5));
            if (!in_array($bruto, $valores, true)) {
                return TDAH_Logus_DB::error("Valor inválido para $chave.");
            }
            return $bruto;
        }

        switch ($tipo) {
            case 'int':
                // Sem esta checagem, um texto qualquer viraria 0 em silêncio,
                // enquanto o modo autônomo recusaria o mesmo valor. Os dois
                // backends precisam falhar do mesmo jeito.
                if (!is_numeric($bruto)) {
                    return TDAH_Logus_DB::error("Valor inválido para $chave.");
                }
                $n = (int) $bruto;
                if ($chave === 'size') {
                    $n = max(1, min(40, $n));
                }
                return $n;
            case 'float':
                if (!is_numeric($bruto)) {
                    return TDAH_Logus_DB::error("Valor inválido para $chave.");
                }
                return (float) $bruto;
            case 'bool':
                return TDAH_Logus_DB::bool($bruto);
            case 'date':
                $d = TDAH_Logus_DB::date_or_null($bruto);
                if ($d === null) {
                    return TDAH_Logus_DB::error("Data inválida em $chave.");
                }
                return $d;
            default:
                $s = (string) $bruto;
                if (mb_strlen($s) > 20000) {
                    return TDAH_Logus_DB::error("Texto longo demais em $chave.");
                }
                return $s;
        }
    }
}
