<?php
/**
 * Conversa no ticket. Espelho de server/comments.js.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TDAH_Logus_Comments
{
    public static function listar($task_id)
    {
        global $wpdb;
        $tc = TDAH_Logus_Schema::table('comments');

        $linhas = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $tc WHERE task_id = %d ORDER BY created_at, id", $task_id
        ));

        $anexos = TDAH_Logus_Uploads::listar($task_id);

        return array_map(function ($c) use ($anexos) {
            $autor = $c->author_id ? get_userdata($c->author_id) : null;
            $do_comentario = array_values(array_filter($anexos, function ($a) use ($c) {
                return (int) $a['commentId'] === (int) $c->id;
            }));

            return [
                'id'             => (int) $c->id,
                'taskId'         => (int) $c->task_id,
                'authorId'       => TDAH_Logus_DB::int_or_null($c->author_id),
                'authorName'     => $autor ? $autor->display_name : null,
                'authorColor'    => $autor ? TDAH_Logus_DB::cor_do_usuario((int) $c->author_id) : null,
                'authorUsername' => $autor ? $autor->user_login : null,
                'body'           => $c->body,
                'createdAt'      => TDAH_Logus_DB::iso($c->created_at),
                'updatedAt'      => TDAH_Logus_DB::iso($c->updated_at),
                'edited'         => (bool) $c->edited,
                'attachments'    => $do_comentario,
            ];
        }, $linhas);
    }

    public static function adicionar($task_id, $corpo)
    {
        global $wpdb;

        $texto = trim((string) $corpo);
        if ($texto === '') {
            return TDAH_Logus_DB::error('O comentário está vazio.');
        }
        if (mb_strlen($texto) > 20000) {
            return TDAH_Logus_DB::error('Comentário longo demais.');
        }

        $tt = TDAH_Logus_Schema::table('tasks');
        if (!$wpdb->get_var($wpdb->prepare("SELECT id FROM $tt WHERE id = %d", $task_id))) {
            return TDAH_Logus_DB::error('Tarefa não encontrada.', 404);
        }

        $wpdb->insert(TDAH_Logus_Schema::table('comments'), [
            'task_id'    => $task_id,
            'author_id'  => get_current_user_id() ? get_current_user_id() : null,
            'body'       => $texto,
            'created_at' => TDAH_Logus_DB::now(),
        ]);

        TDAH_Logus_Events::log([
            'task_id' => $task_id,
            'kind'    => 'comment',
            'to'      => mb_substr($texto, 0, 160),
        ]);
        TDAH_Logus_Tasks::tocar($task_id);

        return (int) $wpdb->insert_id;
    }

    public static function editar($comment_id, $corpo)
    {
        global $wpdb;
        $tc = TDAH_Logus_Schema::table('comments');

        $c = $wpdb->get_row($wpdb->prepare("SELECT * FROM $tc WHERE id = %d", $comment_id));
        if (!$c) {
            return TDAH_Logus_DB::error('Comentário não encontrado.', 404);
        }
        if ((int) $c->author_id !== get_current_user_id()) {
            return TDAH_Logus_DB::error('Só quem escreveu pode editar o comentário.', 403);
        }

        $texto = trim((string) $corpo);
        if ($texto === '') {
            return TDAH_Logus_DB::error('O comentário está vazio.');
        }

        $wpdb->update($tc, [
            'body'       => $texto,
            'updated_at' => TDAH_Logus_DB::now(),
            'edited'     => 1,
        ], ['id' => $comment_id]);

        TDAH_Logus_Tasks::tocar((int) $c->task_id);
        return (int) $c->task_id;
    }

    public static function apagar($comment_id)
    {
        global $wpdb;
        $tc = TDAH_Logus_Schema::table('comments');

        $c = $wpdb->get_row($wpdb->prepare("SELECT * FROM $tc WHERE id = %d", $comment_id));
        if (!$c) {
            return null;
        }
        if ((int) $c->author_id !== get_current_user_id() && !current_user_can('manage_options')) {
            return TDAH_Logus_DB::error('Só quem escreveu pode apagar o comentário.', 403);
        }

        $ta = TDAH_Logus_Schema::table('attachments');
        $arquivos = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $ta WHERE comment_id = %d", $comment_id
        ));
        foreach ($arquivos as $a) {
            TDAH_Logus_Uploads::remover_arquivo($a->stored_name);
        }
        $wpdb->delete($ta, ['comment_id' => $comment_id]);
        $wpdb->delete($tc, ['id' => $comment_id]);

        TDAH_Logus_Tasks::tocar((int) $c->task_id);
        return (int) $c->task_id;
    }
}
