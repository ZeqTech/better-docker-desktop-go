package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// The built frontend is embedded into the binary, so the app works offline.
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	fixPath()

	notifier := notifications.New()
	svc := newApp(notifier)

	app := application.New(application.Options{
		Name:        "Better Docker Desktop",
		Description: "A faster, simpler Docker Desktop with Kubernetes views",
		Services: []application.Service{
			application.NewService(svc),
			application.NewService(notifier),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
	svc.app = app

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Better Docker Desktop",
		Width:            1280,
		Height:           800,
		MinWidth:         900,
		MinHeight:        600,
		BackgroundColour: application.NewRGB(15, 18, 32),
		URL:              "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
