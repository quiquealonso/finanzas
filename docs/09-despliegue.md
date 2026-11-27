# 09 · Despliegue (servidor público)

Para el proyecto de clase la app está publicada; después de la defensa se despublica (ver «Despublicar»).

| Qué | Dónde |
|---|---|
| Demo (datos inventados, sin back) | `https://quiquealonso.github.io/finanzas/` (GitHub Pages) |
| App real | `https://quiquealonso.github.io/finanzas/app/` (GitHub Pages) |
| API | VM de Google Cloud propia de Finanzas, `https://<IP con guiones>.sslip.io` (Caddy + HTTPS de Let's Encrypt) |
| Base de datos | Supabase (la misma que en el ordenador) |

Mismo montaje que PanGestion (front en Pages, API en una VM con Docker y Caddy, despliegue por SSH con clave limitada),
pero en **otra VM**: si una app falla o se apaga, la otra no se entera.

## Capas de seguridad

1. **Nadie lee datos de otro.** RLS en Postgres: cada consulta va como `finanzas_app` con `app.user_id` del token
   ([02](02-arquitectura.md#multiusuario)). Un usuario registrado empieza vacío y solo ve sus filas. La tabla `users`
   solo deja ver la propia fila. Los roles públicos de Supabase (`anon`, `authenticated`) no tienen permiso sobre
   ninguna tabla (comprobado el 2026-11-27: 54 tablas con RLS, 0 permisos de `anon`).
2. **Registro cerrado por defecto.** Solo con `REGISTER_CODE` (palabra que el dueño dice en persona) y como mucho
   `REGISTER_MAX` cuentas (5). Sin código, el registro no existe. Contraseña de 12 caracteres o más, BCrypt.
3. **Login.** Usuario + contraseña; la lista de usuarios ya no se envía. 10 intentos fallidos por IP y por usuario cada
   15 min (también en el registro). `TRUST_PROXY=1` para que cuente la IP real detrás de Caddy.
4. **Solo el dueño** (`OWNER_USER`) lanza lo que escribe datos compartidos o gasta cuota: precios, tipo de cambio,
   Sentimiento, Valoraciones (`src/server-mode.ts`). Apuestas y Fórmula mágica solo se ven con `user1`.
5. **Gmail y bancos apagados en el servidor** (`INTEGRATIONS=off`): el token de Gmail, la clave `.pem` de Enable
   Banking y la clave de Gemini **no están en la VM**. Se siguen sincronizando desde el ordenador del dueño, que escribe
   en la misma base. Tampoco hay temporizadores en la VM (`BACKGROUND_JOBS=off`): los corre el ordenador.
6. **CORS**: solo `https://quiquealonso.github.io` puede llamar a la API desde un navegador. Ojo: CORS no frena a
   `curl`; eso lo hacen el token y RLS.
7. **Cabeceras** (Caddy): HSTS, CSP, nosniff, sin iframes, sin `Server` ni `X-Powered-By`. Fuera de `/api/` todo es 404.
   En Pages, CSP en `<meta>`: solo scripts propios y conexiones al propio sitio y a la API.
8. **Contenedor**: usuario sin privilegios, sistema de ficheros de solo lectura, sin capacidades, 512 MB como máximo.
   El back solo escucha en la red interna de Docker; lo único abierto en la VM es 80/443 (Caddy) y SSH.
9. **Base de datos**: restricción de red de Supabase (solo la IP de la VM y la de casa), contraseña nueva para el
   servidor, SSL obligatorio.

## Montarlo (una vez)

Todo lo hace el dueño con su cuenta; nada de esto lo puede hacer el asistente.

### 1. Supabase

1. **Settings → Database → Reset database password**: contraseña nueva y larga. Cambia también `DIRECT_URL` en
   `back/.env` del ordenador.
2. **Settings → Database → SSL Configuration → Enforce SSL**.
3. **Settings → Database → Network Restrictions**: añade la IP de casa y, cuando exista, la IP fija de la VM (`/32`).
   Si cambia la IP de casa, el back del ordenador dejará de conectar: se añade la nueva aquí.
4. **Settings → API → Data API**: desactívala (la app no la usa; la app móvil está en pausa).
5. Doble factor (MFA) en Supabase, GitHub y Google Cloud.
6. SQL nuevo (ya aplicado el 2026-11-27): `supabase/auth.sql` (usuario, registro) y el bloque `users` de `users.sql`.

### 2. VM en Google Cloud

1. Proyecto nuevo `finanzas`. **Billing → Budgets & alerts**: presupuesto de 5 € con aviso.
2. Compute Engine → **Create instance**: `e2-micro`, región `us-central1` (nivel gratuito), Debian 12, disco estándar de
   30 GB, sin cuenta de servicio (**No service account**), marca *Allow HTTP* y *Allow HTTPS*.
3. VPC network → **IP addresses → Reserve** la IP externa de la VM como estática.
4. Firewall: borra la regla `default-allow-rdp` y limita `default-allow-ssh` a la IP de casa (o a `35.235.240.0/20`
   si usas SSH por el navegador / IAP).
5. Por SSH en la VM:
   ```bash
   sudo apt update && sudo apt -y upgrade && sudo apt -y install unattended-upgrades git curl
   curl -fsSL https://get.docker.com | sudo sh
   sudo adduser --disabled-password --gecos "" finanzas && sudo usermod -aG docker finanzas
   sudo -iu finanzas
   mkdir -p ~/finanzas && git clone https://github.com/quiquealonso/finanzas.git ~/finanzas/app
   cd ~/finanzas/app/back/deploy && cp .env.example .env && chmod 600 .env && nano .env
   ```
   Rellena `.env` (cada variable está explicada en `.env.example`): `API_DOMAIN` = la IP con guiones + `.sslip.io`,
   `DIRECT_URL` con la contraseña nueva, `AUTH_SECRET` **nuevo** (`openssl rand -base64 48`), `REGISTER_CODE`.
6. Primer arranque: `docker compose up -d --build` y prueba `curl https://<API_DOMAIN>/api/auth/register`.
7. Contraseñas de tus usuarios en el servidor no hace falta: están en la base (las mismas que en el ordenador).

### 3. Despliegue automático (GitHub Actions)

1. En tu ordenador: `ssh-keygen -t ed25519 -f finanzas-deploy -N ""` (clave solo para desplegar).
2. En la VM (usuario `finanzas`), en `~/.ssh/authorized_keys`, una línea que solo puede ejecutar el script:
   `command="/home/finanzas/finanzas/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… finanzas-deploy`
   y `install -m 755 ~/finanzas/app/back/deploy/deploy.sh ~/finanzas/deploy.sh`.
3. En GitHub → Settings → Secrets and variables → Actions:
   - Secrets: `VM_SSH_KEY` (contenido de `finanzas-deploy`, la privada), `VM_KNOWN_HOSTS` (`ssh-keyscan <IP>`),
     `VM_HOST` (la IP).
   - Variables: `API_URL` = `https://<API_DOMAIN>` (sin barra final).
   Borra `finanzas-deploy` del ordenador después de pegarla.
4. Con `API_URL` puesta, cada push a `main` con el CI en verde: `deploy.yml` despliega la API y la comprueba desde fuera
   (cabeceras, CORS, 401 sin sesión, Gmail/bancos 403); `pages.yml` publica la demo y la app real en `/app/`.

## Para el profesor

Dale la dirección `https://quiquealonso.github.io/finanzas/app/` y el código de registro **en persona**. Crea su
cuenta (empieza vacía) o usa la demo guiada. Ver cuántas plazas quedan: `GET /api/auth/register`.

## Operación

```bash
cd ~/finanzas/app/back/deploy
docker compose logs api --since 1h          # la última hora
docker compose logs api | grep "registro"   # quién se ha registrado (id del usuario)
docker compose restart api                  # tras cambiar .env
```

Cerrar el registro: vacía `REGISTER_CODE` en `.env` y `docker compose up -d api`.

## Despublicar (después de la defensa)

1. GitHub → Settings → Secrets and variables → Variables: borra `API_URL` (Pages vuelve a publicar solo la demo en el
   siguiente despliegue) y los secretos `VM_*`.
2. Google Cloud: para la VM (se puede volver a arrancar) o bórrala junto con la IP estática (no se puede deshacer).
3. Supabase: quita la IP de la VM de Network Restrictions y cambia otra vez la contraseña de la base.
4. Cambia `AUTH_SECRET` en el ordenador si alguna vez fue el mismo que el del servidor.
5. Cuentas registradas: `select public.delete_user_data('<id>')` y `delete from users where id = '<id>'` (borrado
   permanente; los ids salen en los logs o en `select id, username from users where "registeredAt" is not null`).
