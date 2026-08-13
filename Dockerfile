# Imagem para rodar o modo autônomo num servidor.
#
# Não há etapa de compilação nem dependências para instalar: a imagem é o
# Node oficial mais o código. O que precisa sobreviver a um novo deploy —
# banco e anexos — vive no volume montado em /data.

FROM node:22-alpine

# Rodar como usuário sem privilégio. A imagem do Node já traz o usuário
# "node"; usá-lo evita que um problema no processo vire acesso de root ao
# contêiner.
WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node core ./core
COPY --chown=node:node server ./server
COPY --chown=node:node web ./web
COPY --chown=node:node assets ./assets

# Banco e anexos ficam fora da imagem, num volume. Sem isso, tudo o que o
# time registrar é perdido no próximo deploy.
ENV TDAH_DATA_DIR=/data
ENV PORT=4173
ENV HOST=0.0.0.0

RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 4173

# Verificação de saúde: /api/boot responde sem sessão, então serve para
# dizer se o processo está de pé sem precisar de credencial.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/boot').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
