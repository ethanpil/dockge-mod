# dockge-mod

dockge-mod is a drop-in replacement for [Dockge](https://github.com/louislam/dockge) by Louis Lam. This fork changes the interface and adds new features. You can put it in an existing Dockge installation, and you can go back to Dockge later.

dockge is a self-hosted manager for Docker Compose stacks. dockge keeps your compose files on your disk and does not move them into a database, unlike other solutions. You can still edit your compose files and use normal `docker compose` commands from the CLI.

For a detailed list of changes from dockge, please see the [dockge-mod changelog](https://github.com/ethanpil/dockge-mod/blob/master/CHANGELOG.md).

<img width="1550" height="819" alt="image" src="https://github.com/user-attachments/assets/b30646a2-6c8f-472b-b47f-f89338af6b2c" />


## dockge Compatibility

dockge and dockge-mod work in the same way:

- The environment variables have the same names.
- The `data` directory and the database have the same format. dockge-mod adds its own tables to the database, but it does not change the tables of Dockge.
- The stacks directory has the same format.
- The default port is 5001.
- An agent connection works between dockge-mod and Dockge in both directions.

You can point dockge-mod at the data directory of an existing Dockge installation. You can also go back to Dockge later. There is no migration step. This is a primary goal of the project.

### The Database

dockge-mod keeps its own data in tables with the `mod_` prefix, in the same SQLite file. It does not add a column to a table of Dockge, and it does not change the migration ledger of Dockge. The `mod_` tables have their own ledger, `mod_knex_migrations`, with its lock table `mod_knex_migrations_lock`. Dockge can then run its own migrations after you go back to it. dockge-mod can run its migrations after you return.

Dockge ignores the `mod_` tables. They stay in the file when you go back to Dockge. Their data is there again when you return to dockge-mod.

### Go Back to Dockge

Change the image in your compose file to the Dockge image, then start the container again. Your data stays. You lose the new features, but you lose no data.

Three conditions apply after you go back:

- The `mod_` tables stay in the database. Dockge does not read them, and they do not change the tables of Dockge.
- The Dockge interface does not show the override file, but `docker compose` continues to merge it. Your stacks keep their behavior, but the interface shows only the base file.
- Dockge does not write the `.env` file when you save a stack. Your `.env` files stay on the disk, but a change that you make in the Dockge editor does not go to the disk.

## Features

- Make, edit, start, stop, restart, and delete compose stacks.
- Update the Docker images of a stack.
- Edit `compose.yaml` in an interactive editor.
- Make and edit an optional override file. Docker merges it with `compose.yaml`. A settings page holds the text of a new override file.
- Open a web terminal for a stack or for the host.
- Manage stacks on more than one Docker host from one interface.
- Change a `docker run` command into a `compose.yaml` file.
- See the progress of a pull, an up, or a down operation while it runs.
- See the resource usage of the containers in a stack.
- See which images have a new version. The server checks the registry every six hours.
- Get a notification on a webhook, ntfy, or Apprise for a new image version, a container that exits with an error, or an unhealthy container.
- Go back to an earlier version of the files of a stack. A save and a git pull keep a copy.
- List and prune the images, the volumes, and the networks of the host.
- See the log of one service.
- Use a git checkout as a stack, with an override file for the local changes.

## Compare

dockge-mod is for a user who runs Dockge now. It keeps the files on the disk, and it keeps the data of Dockge. Other tools do more, but they do not use the Dockge data:

| | dockge-mod | Dockge | Arcane | Komodo |
| --- | --- | --- | --- | --- |
| Keeps the files on the disk | Yes | Yes | Yes | Yes |
| Uses the Dockge data, goes back to Dockge | Yes | - | No | No |
| Override file and git checkout | Yes | No | Git only | Git only |
| Image update check | Yes | No | Yes | Yes |
| Notifications | Yes | No | Yes | Yes |
| Images, volumes, networks | Yes | No | Yes | Yes |
| OIDC or SSO | No | No | Yes | Yes |
| Kubernetes | No | No | No | No |

If you need SSO or many users, use Arcane or Komodo. If you run Dockge and want to keep it, use dockge-mod.

## Requirements

You must have this software and hardware:

- Docker 20 or later, or Podman.
- For Podman only: the `podman-docker` package. On Debian, run `apt install podman-docker`.
- A Linux system that can run Docker or Podman. Ubuntu, Debian, Raspbian, CentOS, Fedora, and Arch Linux are known to work.
- A CPU architecture of armv7, arm64, or amd64.

Debian Buster and Raspbian Buster are too old. Windows is not supported.

## Install

The image is on Docker Hub as [`ethanpil/dockge-mod`](https://hub.docker.com/r/ethanpil/dockge-mod). It is available for amd64, arm64, and armv7. You do not need the source code to run it.

Each image has two tags: `latest`, and a version such as `1.5.0-mod-a1b2c3d`. The version tag does not change, thus you can select an image and go back to it. The About page shows the version of the image that you run. A new image goes to Docker Hub at a release, and not at each change of the code, thus `latest` can be older than the source code.

### Step 1. Make the Directories

Make one directory for your stacks and one directory for dockge-mod.

```bash
mkdir -p /opt/stacks /opt/dockge-mod
```

### Step 2. Make the Compose File

The two stack paths in the `volumes` section must be the same. If the two paths are different, dockge-mod writes your data to a wrong path.

- A correct example is `/opt/stacks:/opt/stacks`. The two paths are the same.
- A wrong example is `/docker:/opt/stacks`. The two paths are different.

Write this text to `/opt/dockge-mod/compose.yaml`:

```yaml
services:
  dockge-mod:
    image: ethanpil/dockge-mod:latest
    restart: unless-stopped
    ports:
      # Host port : container port
      - 5001:5001
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data

      # Your stacks directory. Use a full path. Do not use a relative path.
      # The path on the left and the path on the right must be the same.
      - /opt/stacks:/opt/stacks
    environment:
      # This tells dockge-mod where your stacks directory is.
      - DOCKGE_STACKS_DIR=/opt/stacks
```

### Step 3. Start the Server

```bash
cd /opt/dockge-mod && docker compose up -d
```

If you use docker-compose V1 or Podman, run `docker-compose up -d` instead.

dockge-mod now runs on `http://localhost:5001`. Open this address in a browser. The first page asks you to make an administrator account.

### Build the Image Yourself

This step is not necessary. Use it if you want to run a change that is not in the published image. Docker does all the build steps, so you do not need Node.js on the host. The build downloads the Node.js and the Go images from Docker Hub.

```bash
git clone https://github.com/ethanpil/dockge-mod.git
cd dockge-mod && docker build --target release -f docker/Dockerfile -t dockge-mod:local .
```

Then put `dockge-mod:local` in the `image` line of your compose file.

## Move from Dockge

dockge-mod can use the data of an existing Dockge installation. Do the steps that follow:

1. Go to the directory that holds the compose file of Dockge.
2. Stop Dockge with `docker compose down`.
3. Make a copy of the `data` directory. Keep this copy in a safe place.
4. In the compose file, change the `image` line to `ethanpil/dockge-mod:latest`.
5. Start the new container with `docker compose up -d`.

Your stacks, your users, and your settings stay the same. To go back to Dockge, change the `image` line again.

## Upgrade

```bash
cd /opt/dockge-mod && docker compose pull && docker compose up -d
```

Your data stays in the `data` volume. Your stacks stay in your stacks directory.

If you build the image yourself, get the new source code with `git pull`, build the image again, then start it with `docker compose up -d`.

## Reverse Proxy

dockge-mod uses a WebSocket connection. Your reverse proxy must send the `Upgrade` and the `Connection` headers to the container, or the interface does not connect.

For nginx, add these lines to the location block:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Caddy and Traefik do this without more configuration.

## Use

### Make a Stack

1. Click **Compose** in the top bar.
2. Type a name for the stack.
3. Type your services in the editor, or paste a `docker run` command into the conversion box.
4. Click **Save** to write the file, or click **Deploy** to write the file and start the stack.

dockge-mod writes the stack to a new directory in your stacks directory.

### Control a Stack

Select a stack in the list on the left. Then use the buttons at the top of the page:

- **Start** starts the containers of the stack.
- **Stop** stops the containers of the stack.
- **Restart** stops and then starts the containers.
- **Update** pulls the newest images and then starts the containers again.
- **Delete** stops the containers and removes the stack directory.

### Add an Existing Stack

dockge-mod reads only the stacks in your stacks directory. To add a stack that is not in this directory, do the steps that follow:

1. Stop the stack with `docker compose down`.
2. Move the compose file to `/opt/stacks/<stackName>/compose.yaml`.
3. Open the menu in the top-right corner of the page.
4. Click **Scan Stacks Folder**.

The stack is now in the list.

### Change the Height of the Panels

A thin bar with a grip is below the compose panels, the logs panel, and the compose and override editors in edit mode. Drag the bar to change the height of the panel above it. A double click on the bar gives the default height back. The heights are not saved. On a narrow window the file panels go one above the other, and the bar below them does not show.

### Edit the Environment Variables

In edit mode, the `.env` panel shows each variable as a pair of fields: one for the key and one for the value. The values are not masked. Click **Add variable** for a new pair. Comments keep their positions. Click **Text** to edit the file as plain text, for example for a comment or a value on more than one line. The **Global .env** page under **Settings** has the same editor.

### Use an Override File

Docker compose merges an override file with the base compose file. Put your changes in the override file when the base file comes from a different source, for example a git repository. An update of the base file does not remove your changes.

To make an override file, do the steps that follow:

1. Open the stack and click **Edit**.
2. Click **Create override** below the compose editor.
3. Write your changes in the new editor.
4. Click **Save** to write the file, or click **Deploy** to write the file and start the stack.

To remove the file, click **Delete override**, then save. An empty editor also removes the file on the next save.

dockge-mod uses the same names as docker: `compose.override.yml`, `compose.override.yaml`, `docker-compose.override.yml`, and `docker-compose.override.yaml`. It uses the first file that it finds. The Dockge interface does not show this file, but `docker compose` continues to merge it. Thus the stacks directory stays compatible.

### See the Merged Configuration

Docker merges the compose file, the override file, and the env files into one configuration. Click **Merged config** at the top of the compose panel to see the result of `docker compose config`. The view is read only, and it shows the files on the disk. If the configuration is not correct, the view shows the error text of docker.

In edit mode, click **Validate** to examine the editor content before you save it. The server puts the content in a temporary directory and runs `docker compose config` on it. The files of the stack do not change. For a stack that exists on the disk, a reference to a file of the stack directory stays correct. Docker finds problems that a YAML check cannot see, for example an unknown key or a wrong service reference.

### Use a Git Checkout as a Stack

A stack directory can be a git checkout. dockge-mod then shows the branch next to the stack name. A dot after the branch shows tracked changes that are not committed. Files that git does not track, for example an override file or a `.env` file, do not cause the dot. A **Pull & Redeploy** button also appears. The button runs `git pull` in the stack directory and then deploys the stack.

When the checkout is on a tag or a commit, and not on a branch, the badge shows the short commit hash. A pull is not possible then, thus the button does not show.

Use a git checkout together with an override file: git holds the base compose file, and your local changes stay in the override file.

The `.git` entry is not visible in the Dockge interface, and Dockge does not touch it. Thus the stacks directory stays compatible.

### See Which Images Have a New Version

The server compares each image of the managed stacks with the registry every six hours. A stack with a new image version shows a badge in the stack list and on the stack page. Click **Update** on the stack page to pull the new version and start the stack again.

The **Resources** page shows each image with the time of the last check. Click **Check now** to start a check at once. A private registry needs the Docker credentials, see **Private Registries** below. An image from a local build has no registry version, and the page says so.

### Get a Notification

Open **Settings** > **Notifications** and add a target. A target is a webhook, an ntfy topic, or an Apprise API. Select the events for the target:

- A new image version is available.
- A container exits with an error. A container that you stop does not send a message.
- A container is unhealthy.

Click **Test** to send a test message. One container sends one message in five minutes, thus a container in a restart loop does not flood the target.

### Go Back to an Earlier Version of a Stack

A save and a git pull make a copy of the compose file, the `.env` file, and the override file before they change them. The last 20 copies of a stack stay in the database, also the `.env` file with its secrets. The copies of a stack go away with the stack when you delete it in the interface. Open the stack and click **Backups** to see the copies. Click **Restore** to write a copy back to the disk. The containers do not change until you click **Deploy**.

### Manage the Images, the Volumes, and the Networks

The **Resources** page lists the images, the volumes, and the networks of a host. You can remove one item, or prune the items that nothing uses. A prune of the volumes removes the data of the volumes that no container uses. Read the list before you confirm.

### See the Log of One Service

Click the log icon of a service in the container table of a stack. A panel shows the log of that service only. The **Logs** panel of the stack shows the log of all services.

### Examine the Health of the Server

The **Health** page under **Settings** shows if the tools that dockge-mod needs are on the server: Docker, Docker Compose, and Git. It also shows if the server can write in the stacks directory and the data directory. The image holds these tools. If you run dockge-mod from the source, install them yourself.

### Use the Terminal

Each stack has a terminal tab. The terminal shows the output of the containers of that stack.

The host terminal is off by default. To make the host terminal available, set `DOCKGE_ENABLE_CONSOLE` to `true`. This terminal gives full access to the host, so be careful.

### Manage More Than One Host

You can control the stacks on other Docker hosts from one interface. Do the steps that follow:

1. Install dockge-mod on each host.
2. Open the home page of the first installation.
3. Click **Add Agent**.
4. Type the URL, the username, and the password of the other installation.

The stacks of each agent are then in the same list. An agent can run dockge-mod or Dockge.

## Environment Variables

The environment variables have the same names as the upstream names. The names keep the `DOCKGE_` prefix on purpose. This keeps your compose file compatible with both programs.

| Name | Default | Function |
| --- | --- | --- |
| `DOCKGE_STACKS_DIR` | `/opt/stacks` | The directory that holds your stacks. |
| `DOCKGE_DATA_DIR` | `./data/` | The directory that holds the database and the settings. |
| `DOCKGE_PORT` | `5001` | The port of the web server. |
| `DOCKGE_HOSTNAME` | none | The hostname that the web server listens on. |
| `DOCKGE_ENABLE_CONSOLE` | `false` | Set this to `true` to make the host terminal available. |
| `DOCKGE_SSL_KEY` | none | The path to an SSL key file. |
| `DOCKGE_SSL_CERT` | none | The path to an SSL certificate file. |
| `DOCKGE_SSL_KEY_PASSPHRASE` | none | The passphrase of the SSL key. |
| `PUID` | none | The user that owns the stack files. |
| `PGID` | none | The group that owns the stack files. |

By default, the stack files belong to `root`. To change the owner, set `PUID` and `PGID`. You must set both variables. If you set only one variable, dockge-mod ignores it.

```yaml
    environment:
      - PUID=1000
      - PGID=1000
```

## Private Registries

To use a private registry, give the Docker authentication file to the container. Add this line to the `volumes` section of your compose file:

```yaml
      - /root/.docker/:/root/.docker
```

## Contributions

This is a personal fork, and I am unlikely to accept pull requests.

If you find a problem in a feature that comes from the upstream project, report it to [Dockge](https://github.com/louislam/dockge/issues). If the problem is only in the interface of this fork, open an issue in this repository.

## Translations

The interface has the languages of the upstream project. The texts of the new features are machine translations, made with Claude. If a text is wrong in your language, open an issue with the key and the correct text.

## AI Assistance

I made the changes in this fork with help from Claude Fable.

## License

dockge-mod uses the MIT license, the same license as the upstream project. The copyright of the original code belongs to Louis Lam. Read the [LICENSE](LICENSE) file for the full text.
