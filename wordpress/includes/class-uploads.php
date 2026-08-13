<?php
/**
 * Anexos.
 *
 * Os arquivos não vão para a biblioteca de mídia do WordPress de propósito:
 * um print colado num ticket interno não deve virar item público da mídia do
 * site, indexável e listado ao lado das imagens das páginas. Eles ficam numa
 * pasta própria, fechada por .htaccess, e saem apenas pela rota da API, que
 * confere quem está pedindo.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TDAH_Logus_Uploads
{
    const MAX_UPLOAD = 12582912; // 12 MB

    public static function permitidos()
    {
        return [
            'image/png'        => '.png',
            'image/jpeg'       => '.jpg',
            'image/gif'        => '.gif',
            'image/webp'       => '.webp',
            'image/avif'       => '.avif',
            'application/pdf'  => '.pdf',
            'text/plain'       => '.txt',
            'text/csv'         => '.csv',
            'application/zip'  => '.zip',
            'application/json' => '.json',
        ];
    }

    public static function inline($mime)
    {
        return in_array($mime, ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'], true);
    }

    public static function dir()
    {
        $up = wp_upload_dir();
        return trailingslashit($up['basedir']) . 'tdah-logus';
    }

    public static function listar($task_id)
    {
        global $wpdb;
        $ta = TDAH_Logus_Schema::table('attachments');

        $linhas = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $ta WHERE task_id = %d ORDER BY id", $task_id
        ));

        return array_map([self::class, 'shape'], $linhas);
    }

    /**
     * Versão pública — nunca inclui o nome do arquivo em disco.
     *
     * Esse nome é sorteado justamente para ser difícil de adivinhar. Se ele
     * viajasse na resposta da API, viraria um endereço direto para o arquivo
     * em qualquer servidor onde o .htaccess da pasta não seja respeitado
     * (Nginx, IIS, ou Apache sem AllowOverride).
     */
    public static function obter($id)
    {
        $a = self::obter_interno($id);
        if (!$a) {
            return null;
        }
        unset($a['storedName']);
        return $a;
    }

    /** Uso interno: entregar e remover o arquivo precisam do nome em disco. */
    public static function obter_interno($id)
    {
        global $wpdb;
        $ta = TDAH_Logus_Schema::table('attachments');
        $a  = $wpdb->get_row($wpdb->prepare("SELECT * FROM $ta WHERE id = %d", $id));
        if (!$a) {
            return null;
        }
        $saida = self::shape($a);
        $saida['storedName'] = $a->stored_name;
        return $saida;
    }

    public static function salvar($task_id, $comment_id, $conteudo, $mime, $nome_original)
    {
        global $wpdb;

        $permitidos = self::permitidos();
        if (!isset($permitidos[$mime])) {
            return TDAH_Logus_DB::error("Tipo de arquivo não aceito: $mime");
        }
        if ($conteudo === '' || $conteudo === null) {
            return TDAH_Logus_DB::error('Arquivo vazio.');
        }
        $tamanho = strlen($conteudo);
        if ($tamanho > self::MAX_UPLOAD) {
            return TDAH_Logus_DB::error('Arquivo acima do limite de 12 MB.');
        }

        $tt = TDAH_Logus_Schema::table('tasks');
        if (!$wpdb->get_var($wpdb->prepare("SELECT id FROM $tt WHERE id = %d", $task_id))) {
            return TDAH_Logus_DB::error('Tarefa não encontrada.', 404);
        }

        $dir = self::dir();
        if (!file_exists($dir)) {
            wp_mkdir_p($dir);
            TDAH_Logus_Schema::protect_uploads();
        }

        // Nome no disco é sorteado; o nome enviado é apenas rótulo e nunca
        // chega perto do sistema de arquivos.
        $guardado = time() . '-' . bin2hex(random_bytes(9)) . $permitidos[$mime];
        $caminho  = trailingslashit($dir) . $guardado;

        if (file_put_contents($caminho, $conteudo) === false) {
            return TDAH_Logus_DB::error('Não foi possível gravar o arquivo.', 500);
        }

        $dimensao = self::dimensoes($caminho, $mime);
        $rotulo   = self::rotulo_seguro($nome_original);
        if ($rotulo === '') {
            $rotulo = 'anexo' . $permitidos[$mime];
        }

        $wpdb->insert(TDAH_Logus_Schema::table('attachments'), [
            'task_id'       => $task_id,
            'comment_id'    => $comment_id ? (int) $comment_id : null,
            'uploader_id'   => get_current_user_id() ? get_current_user_id() : null,
            'original_name' => $rotulo,
            'stored_name'   => $guardado,
            'mime'          => $mime,
            'size_bytes'    => $tamanho,
            'width'         => $dimensao ? $dimensao[0] : null,
            'height'        => $dimensao ? $dimensao[1] : null,
            'created_at'    => TDAH_Logus_DB::now(),
        ]);

        TDAH_Logus_Events::log(['task_id' => $task_id, 'kind' => 'attachment', 'to' => $rotulo]);
        TDAH_Logus_Tasks::tocar($task_id);

        return self::obter((int) $wpdb->insert_id);
    }

    public static function apagar($id)
    {
        global $wpdb;
        $ta = TDAH_Logus_Schema::table('attachments');

        $a = $wpdb->get_row($wpdb->prepare("SELECT * FROM $ta WHERE id = %d", $id));
        if (!$a) {
            return null;
        }
        if ((int) $a->uploader_id !== get_current_user_id() && !current_user_can('manage_options')) {
            return TDAH_Logus_DB::error('Só quem enviou pode remover o anexo.', 403);
        }

        self::remover_arquivo($a->stored_name);
        $wpdb->delete($ta, ['id' => $id]);
        TDAH_Logus_Tasks::tocar((int) $a->task_id);
        return true;
    }

    public static function remover_arquivo($guardado)
    {
        // basename fecha a porta para qualquer tentativa de subir de pasta
        // por um nome manipulado no banco.
        $caminho = trailingslashit(self::dir()) . basename($guardado);
        if (file_exists($caminho)) {
            @unlink($caminho);
        }
    }

    private static function shape($a)
    {
        $autor = $a->uploader_id ? get_userdata($a->uploader_id) : null;

        return [
            'id'           => (int) $a->id,
            'taskId'       => (int) $a->task_id,
            'commentId'    => TDAH_Logus_DB::int_or_null($a->comment_id),
            'name'         => $a->original_name,
            'mime'         => $a->mime,
            'size'         => (int) $a->size_bytes,
            'width'        => TDAH_Logus_DB::int_or_null($a->width),
            'height'       => TDAH_Logus_DB::int_or_null($a->height),
            'uploaderId'   => TDAH_Logus_DB::int_or_null($a->uploader_id),
            'uploaderName' => $autor ? $autor->display_name : null,
            'createdAt'    => TDAH_Logus_DB::iso($a->created_at),
            'isImage'      => strpos($a->mime, 'image/') === 0,
            'url'          => 'api/attachments/' . (int) $a->id,
        ];
    }

    private static function dimensoes($caminho, $mime)
    {
        if (strpos($mime, 'image/') !== 0) {
            return null;
        }
        $info = @getimagesize($caminho);
        if (!$info) {
            return null;
        }
        return [(int) $info[0], (int) $info[1]];
    }

    private static function rotulo_seguro($nome)
    {
        $nome = str_replace(['\\', '/'], '_', (string) $nome);
        $nome = preg_replace('/[\x00-\x1f\x7f<>:"|?*]/u', '', $nome);
        return mb_substr(trim($nome), 0, 120);
    }
}
