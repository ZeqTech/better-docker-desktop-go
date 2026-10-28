package main

import (
	"errors"
	"os/exec"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

const appVersion = "0.2.1"

// App is the service the frontend calls. Every exported method is reachable from TypeScript as
// `main.App.<Method>`; errors reject the call with their message.
type App struct {
	app      *application.App
	notifier *notifications.NotificationService
	streams  *streams
	shells   *shells
}

func newApp(notifier *notifications.NotificationService) *App {
	a := &App{notifier: notifier}
	emit := func(name string, data any) {
		if a.app != nil {
			a.app.Event.Emit(name, data)
		}
	}
	a.streams = newStreams(emit)
	a.shells = newShells(emit)
	return a
}

func (a *App) AppVersion() string { return appVersion }

// ---- docker -----------------------------------------------------------------------------

func (a *App) DockerStatus() DockerStatus { return dockerStatus() }
func (a *App) StartEngine() (string, error) { return startEngine() }
func (a *App) SetDockerPath(path string) error { return setDockerPath(path) }
func (a *App) ReadEngineConfig() (EngineConfig, error) { return readEngineConfig() }
func (a *App) WriteEngineConfig(content string) (string, error) { return writeEngineConfig(content) }

func (a *App) ContainerLs(container, path string) (string, error) { return containerLs(container, path) }
func (a *App) ContainerCopyOut(container, path, dest string) (string, error) {
	return containerCopyOut(container, path, dest)
}
func (a *App) ContainerCopyIn(container, src, dest string) (string, error) {
	return containerCopyIn(container, src, dest)
}
func (a *App) ImageHistory(image string) (string, error) { return imageHistory(image) }
func (a *App) VolumeContainers(name string) (string, error) { return containersUsingVolume(name) }
func (a *App) VolumeHelperImage() (*string, error) { return volumeHelperImage() }
func (a *App) VolumeLs(volume, image, path string) (string, error) { return volumeLs(volume, image, path) }
func (a *App) VolumeRead(volume, image, path string) (string, error) {
	return volumeRead(volume, image, path)
}
func (a *App) ListContainers() (string, error) { return listContainers() }
func (a *App) ContainerStats() (string, error) { return containerStats() }
func (a *App) ListImages() (string, error) { return listImages() }
func (a *App) DiskUsage() (string, error) { return diskUsage() }
func (a *App) BuildHistory() (string, error) { return buildHistory() }
func (a *App) Inspect(kind, target string) (string, error) { return inspect(kind, target) }
func (a *App) ContainerAction(id, action string) (string, error) { return containerAction(id, action) }
func (a *App) ComposeProjectAction(project, action string) (string, error) {
	return composeProjectAction(project, action)
}
func (a *App) ImageRemove(image string, force bool) (string, error) { return imageRemove(image, force) }
func (a *App) ImageTag(source, target string) (string, error) { return imageTag(source, target) }
func (a *App) ImageRun(opts RunOptions) (string, error) { return imageRun(opts) }
func (a *App) Prune(kind string) (string, error) { return pruneKind(kind) }
func (a *App) VolumeCreate(name string) (string, error) { return volumeCreate(name) }
func (a *App) VolumeRemove(name string, force bool) (string, error) { return volumeRemove(name, force) }
func (a *App) BuildHistoryRemove(reference string) (string, error) { return buildHistoryRemove(reference) }

// ---- kubernetes -------------------------------------------------------------------------

func (a *App) KubeStatus() KubeStatus { return kubeStatus() }
func (a *App) KubeGet(context, kind, namespace string) (string, error) {
	return kubeGet(context, kind, namespace)
}
func (a *App) KubeMetrics(context, kind string) (string, error) { return kubeMetrics(context, kind) }
func (a *App) KubeShow(context, mode, kind, name, namespace string) (string, error) {
	return kubeShow(context, mode, kind, name, namespace)
}
func (a *App) KubeAct(context, action, kind, name, namespace string) (string, error) {
	return kubeAct(context, action, kind, name, namespace)
}

// ---- streams and shells -----------------------------------------------------------------

// StartStream runs `logs`, `pull`, `build`, ... Output arrives as `stream-line` events and the end
// as `stream-end`; starting a second stream under the same id replaces it.
func (a *App) StartStream(id, kind, target, context string, tail int, timestamps bool, since string) error {
	if tail <= 0 {
		tail = 500
	}
	var cmd *exec.Cmd
	var err error
	if kind == "kubelogs" {
		// context = kubectl context, target = namespace/pod/container
		cmd, err = kubeLogsCommand(context, target, tail, timestamps)
	} else {
		cmd, err = streamCommand(kind, target, context, tail, timestamps, since)
	}
	if err != nil {
		return err
	}
	return a.streams.start(id, cmd)
}

func (a *App) StopStream(id string) { a.streams.stop(id) }

// StartShell opens an interactive shell in a container, or in a pod when all three kube values are given.
func (a *App) StartShell(id, container string, cols, rows int, kubeContext, kubeNamespace, kubePod string) error {
	var program string
	var args []string
	var err error
	if kubeContext != "" && kubeNamespace != "" && kubePod != "" {
		program = kubeProgram()
		args, err = kubeShellArgs(kubeContext, kubeNamespace, kubePod, container)
	} else {
		program = dockerProgram()
		args, err = shellArgs(container)
	}
	if err != nil {
		return err
	}
	return a.shells.start(id, program, args, cols, rows)
}

func (a *App) ShellWrite(id, data string) error { return a.shells.write(id, data) }
func (a *App) ShellResize(id string, cols, rows int) error { return a.shells.resize(id, cols, rows) }
func (a *App) StopShell(id string) { a.shells.stop(id) }

// ---- desktop integration ----------------------------------------------------------------

// PickFolder shows a folder chooser; the result is empty when cancelled.
func (a *App) PickFolder(title string) (string, error) {
	return a.app.Dialog.OpenFile().CanChooseDirectories(true).CanChooseFiles(false).SetTitle(title).PromptForSingleSelection()
}

// PickFile shows a file chooser limited to `pattern` (e.g. "*.tar;*.gz"); the result is empty when cancelled.
func (a *App) PickFile(title, filterName, pattern string) (string, error) {
	d := a.app.Dialog.OpenFile().CanChooseFiles(true).SetTitle(title)
	if pattern != "" {
		d = d.AddFilter(filterName, pattern)
	}
	return d.PromptForSingleSelection()
}

// SaveFilePath shows a save dialog; the result is empty when cancelled.
func (a *App) SaveFilePath(defaultName, filterName, pattern string) (string, error) {
	d := a.app.Dialog.SaveFile().SetFilename(defaultName)
	if pattern != "" {
		d = d.AddFilter(filterName, pattern)
	}
	return d.PromptForSingleSelection()
}

// OpenURL opens a localhost page in the default browser. Anything else is refused.
func (a *App) OpenURL(url string) error {
	if !(strings.HasPrefix(url, "http://localhost:") || strings.HasPrefix(url, "http://127.0.0.1:") ||
		strings.HasPrefix(url, "https://localhost:") || strings.HasPrefix(url, "https://127.0.0.1:")) {
		return errors.New("only localhost links can be opened from here")
	}
	return a.app.Browser.OpenURL(url)
}

// Notify raises a desktop notification; failures are ignored because the list still updates.
func (a *App) Notify(title, body string) {
	if a.notifier == nil {
		return
	}
	if ok, _ := a.notifier.CheckNotificationAuthorization(); !ok {
		if ok, _ = a.notifier.RequestNotificationAuthorization(); !ok {
			return
		}
	}
	_ = a.notifier.SendNotification(notifications.NotificationOptions{
		ID:    "bdd-" + title,
		Title: title,
		Body:  body,
	})
}
