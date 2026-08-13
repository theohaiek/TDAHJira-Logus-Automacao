<?php
/**
 * A trilha. Espelho de server/events.js.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TDAH_Logus_Events
{
    public static function log($args)
    {
        global $wpdb;

        $args = wp_parse_args($args, [
            'task_id'  => null,
            'actor_id' => get_current_user_id(),
            'kind'     => 'update',
            'field'    => null,
            'from'     => null,
            'to'       => null,
            'note'     => null,
        ]);

        $wpdb->insert(
            TDAH_Logus_Schema::table('events'),
            [
                'task_id'    => $args['task_id'],
                'actor_id'   => $args['actor_id'] ? $args['actor_id'] : null,
                'kind'       => $args['kind'],
                'field'      => $args['field'],
                'from_value' => $args['from'] === null ? null : (string) $args['from'],
                'to_value'   => $args['to'] === null ? null : (string) $args['to'],
                'note'       => $args['note'],
                'created_at' => TDAH_Logus_DB::now(),
            ]
        );

        return (int) $wpdb->insert_id;
    }

    public static function timeline($task_id)
    {
        global $wpdb;
        $t = TDAH_Logus_Schema::table('events');

        $linhas = $wpdb->get_results(
            $wpdb->prepare("SELECT * FROM $t WHERE task_id = %d ORDER BY id", $task_id)
        );

        return array_map([self::class, 'shape'], $linhas);
    }

    public static function recent($limit = 60)
    {
        global $wpdb;
        $e  = TDAH_Logus_Schema::table('events');
        $ta = TDAH_Logus_Schema::table('tasks');
        $p  = TDAH_Logus_Schema::table('projects');

        $limit = min(max((int) $limit, 1), 300);

        $linhas = $wpdb->get_results($wpdb->prepare(
            "SELECT e.*, t.title AS task_title, t.number AS task_number, p.proj_key AS project_key
               FROM $e e
               LEFT JOIN $ta t ON t.id = e.task_id
               LEFT JOIN $p p ON p.id = t.project_id
              WHERE e.task_id IS NOT NULL
              ORDER BY e.id DESC
              LIMIT %d",
            $limit
        ));

        return array_map(function ($linha) {
            $base = self::shape($linha);
            $base['taskTitle'] = $linha->task_title;
            $base['taskKey']   = ($linha->project_key && $linha->task_number)
                ? $linha->project_key . '-' . $linha->task_number
                : null;
            return $base;
        }, $linhas);
    }

    public static function cursor()
    {
        global $wpdb;
        $t = TDAH_Logus_Schema::table('events');
        return (int) $wpdb->get_var("SELECT COALESCE(MAX(id), 0) FROM $t");
    }

    public static function changed_since($cursor)
    {
        global $wpdb;
        $t = TDAH_Logus_Schema::table('events');
        $ids = $wpdb->get_col($wpdb->prepare(
            "SELECT DISTINCT task_id FROM $t WHERE id > %d AND task_id IS NOT NULL",
            (int) $cursor
        ));
        return array_map('intval', $ids);
    }

    private static function shape($e)
    {
        $autor = $e->actor_id ? get_userdata($e->actor_id) : null;

        return [
            'id'         => (int) $e->id,
            'taskId'     => TDAH_Logus_DB::int_or_null($e->task_id),
            'actorId'    => TDAH_Logus_DB::int_or_null($e->actor_id),
            'actorName'  => $autor ? $autor->display_name : null,
            'actorColor' => $autor ? TDAH_Logus_DB::cor_do_usuario((int) $e->actor_id) : null,
            'kind'       => $e->kind,
            'field'      => $e->field,
            'from'       => $e->from_value,
            'to'         => $e->to_value,
            'note'       => $e->note,
            'at'         => TDAH_Logus_DB::iso($e->created_at),
        ];
    }
}
