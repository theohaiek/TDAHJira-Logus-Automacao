<?php
/**
 * Utilidades de acesso ao banco e conversão de formatos.
 *
 * O front espera datas em ISO 8601 com fuso, e o MySQL do WordPress guarda
 * datetime sem fuso. A conversão acontece toda aqui, num lugar só, para que
 * nenhuma tela precise saber disso.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TDAH_Logus_DB
{
    public static function now()
    {
        return gmdate('Y-m-d H:i:s');
    }

    public static function today()
    {
        // Data local do site, e não UTC: quem usa raciocina no fuso em que vive.
        return wp_date('Y-m-d');
    }

    /** datetime do banco (UTC) para ISO 8601 com Z. */
    public static function iso($valor)
    {
        if (empty($valor) || $valor === '0000-00-00 00:00:00') {
            return null;
        }
        return str_replace(' ', 'T', $valor) . 'Z';
    }

    public static function int_or_null($v)
    {
        if ($v === null || $v === '' || $v === false) {
            return null;
        }
        return (int) $v;
    }

    public static function date_or_null($v)
    {
        if (empty($v)) {
            return null;
        }
        $s = substr((string) $v, 0, 10);
        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) ? $s : null;
    }

    public static function bool($v)
    {
        return in_array($v, [true, 1, '1', 'true'], true) ? 1 : 0;
    }

    /**
     * Erro no formato que o front já sabe ler: o cliente é o mesmo nos dois
     * modos, então a forma da resposta de erro também precisa ser.
     */
    public static function error($mensagem, $status = 400)
    {
        return new WP_Error('tdah_logus', $mensagem, ['status' => $status]);
    }

    public static function usuario_publico($user)
    {
        if (!$user) {
            return null;
        }
        return [
            'id'     => (int) $user->ID,
            'username' => $user->user_login,
            'name'   => $user->display_name ? $user->display_name : $user->user_login,
            'color'  => self::cor_do_usuario((int) $user->ID),
            'role'   => user_can($user, 'manage_options') ? 'admin' : 'member',
            'active' => true,
        ];
    }

    /**
     * Cor estável por pessoa, derivada do próprio identificador.
     * Serve para reconhecer quem é quem no avatar sem pedir que alguém
     * escolha uma cor no cadastro.
     */
    public static function cor_do_usuario($user_id)
    {
        $salva = get_user_meta($user_id, 'tdah_logus_color', true);
        if ($salva) {
            return $salva;
        }
        $paleta = ['#a2e4f0', '#7fc8a9', '#e3b877', '#d98fa8', '#8fa9b5', '#b6a8e0', '#8fc9e8'];
        return $paleta[$user_id % count($paleta)];
    }

    public static function usuarios()
    {
        $lista = get_users([
            'capability' => 'read',
            'orderby'    => 'display_name',
            'number'     => 200,
        ]);
        return array_values(array_map([self::class, 'usuario_publico'], $lista));
    }
}
