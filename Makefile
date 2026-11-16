UUID := sourceglance@omer-gh.github.io
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
ZIP := dist/$(UUID).shell-extension.zip

.PHONY: install pack lint test smoke

install:
	mkdir -p $(INSTALL_DIR)
	cp -r src/. $(INSTALL_DIR)/
	glib-compile-schemas $(INSTALL_DIR)/schemas
	@echo "Installed to $(INSTALL_DIR). Log out and back in on Wayland, then run:"
	@echo "  gnome-extensions enable $(UUID)"

# GNOME Shell 45+ compiles schemas itself, so the zip ships only the XML.
pack:
	mkdir -p dist
	cd src && zip -FS -r ../$(ZIP) . -x 'schemas/gschemas.compiled'
	@echo "Built $(ZIP)"

lint:
	npx eslint src tests

test:
	node --test tests/*.test.js

smoke:
	./tools/shell-smoke.sh
