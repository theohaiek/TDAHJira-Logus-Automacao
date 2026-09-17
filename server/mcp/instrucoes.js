// O que o agente lê ao conectar, antes de qualquer ferramenta.
//
// Vai no `instructions` do initialize, e o Claude Code põe isso no contexto de
// toda sessão que tem o servidor ligado. Cada palavra aqui custa em todas as
// sessões de todas as máquinas: tests/mcp.test.js segura o teto.
//
// Duas coisas que este texto precisa fazer, e nada mais: fazer o agente
// registrar tudo, e fazer ele registrar curto. O detalhe de cada ferramenta
// mora na descrição dela, que é onde o agente olha na hora de chamar.
export const INSTRUCOES = `Tickets do time (TDAH Jira, Logus). Registre aqui todo trabalho feito num ticket, na hora:
- antes de começar: ler (traz o último handoff)
- ao fechar um bloco de trabalho: registrar tipo=sessao
- ao parar ou passar adiante: registrar tipo=handoff
- PR, commit, branch, doc: vincular
- mudou de fase: editar status
- print ou log de teste: anexar
Escrita extremamente curta e operacional: fatos, ids, comandos, próximo passo. Sem prosa, sem repetir o ticket, sem travessão.
sessao: "Feito: … Resultado: … Próximo: …"
handoff: "Estado: … Próximo: … Aberto: …"
Ticket: chave (AUT-14) ou #id. Pessoa: username ou eu. Horas em UTC.`;
