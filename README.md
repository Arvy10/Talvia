# Talvia

Landing page publique et expérience d’authentification frontend de Talvia.

## Démarrage local

```bash
npm install
npm run dev
```

Ouvrez ensuite [http://localhost:3000](http://localhost:3000).

## Vérifications

```bash
npm run lint
npm run build
```

Le backend, l’authentification et les intégrations aux canaux sont volontairement mockés pour cette première version.

## Acquisition bêta par e-mail

Appliquez `db/migrations/013_acquisition_email.sql` à Neon, vérifiez votre domaine d’envoi dans Resend, puis renseignez les variables `RESEND_*`, `APP_URL`, `ACQUISITION_SCHEDULER_SECRET` et `ACQUISITION_UNSUBSCRIBE_SECRET`. Configurez le webhook Resend signé vers `${APP_URL}/api/webhooks/resend`. Configurez ensuite un cron de l’hébergeur pour appeler `POST ${APP_URL}/api/acquisition/scheduler` avec l’en-tête `Authorization: Bearer ${ACQUISITION_SCHEDULER_SECRET}`.
