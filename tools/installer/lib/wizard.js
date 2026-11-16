// MSI-style setup wizard window (docs/design/installer.md).
// Uses only GTK 4.14 / libadwaita 1.5 APIs so it runs on GNOME 46 (Ubuntu 24.04).
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import {EXIT, allChecksPass, decideMode, evaluateChecks, flowFor, operationFor, readySummary} from './plan.js';
import {
    Log, PAYLOAD_DIR, SETTINGS_PATH, backupsDir, extensionDir, gatherFacts, installedVersion,
    licenseText, packageMetadata, run, setUserExtensionsEnabled, tildify,
} from './system.js';
import {install, remove} from './operations.js';

const LICENSE_URL = 'https://github.com/omer-gh/sourceglance/blob/main/LICENSE';
const REPORT_URL = 'https://github.com/omer-gh/sourceglance/issues/new?template=bug_report.yml';
const esc = text => GLib.markup_escape_text(text, -1);

function label(text, {css = [], markup = false, selectable = false} = {}) {
    return new Gtk.Label({
        label: text, use_markup: markup, wrap: true, xalign: 0, selectable, css_classes: css,
    });
}

function vbox(spacing = 12, children = []) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing});
    for (const child of children)
        box.append(child);
    return box;
}

/** Join hard-wrapped lines within paragraphs so the text view can wrap them itself. */
function reflow(text) {
    return text.trim().split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ')).join('\n\n');
}

function bullets(lines) {
    return label(lines.map(l => `•  ${esc(l)}`).join('\n'), {markup: true});
}

export class Wizard {
    constructor(app, {preselect = null, logFile = null}) {
        this.app = app;
        this.exitCode = EXIT.CANCELLED;
        this.meta = packageMetadata() ?? {};
        this.version = this.meta['version-name'] ?? '?';
        this.shellVersions = this.meta['shell-version'] ?? [];
        this.installed = installedVersion();
        this.mode = decideMode(this.installed, this.version);
        this.choice = this.mode === 'maintain' ? (preselect ?? 'repair') : preselect;
        this.log = new Log(logFile);
        this.busy = false;
        this.finished = false;
        this.checks = null;
        this.settingsExist = false;

        this._buildWindow();
        this._buildPages();
        this.flow = flowFor(this.mode, this.choice);
        this._show(0);

        run(['dconf', 'dump', SETTINGS_PATH]).then(({stdout}) => {
            this.settingsExist = stdout.trim().length > 0;
            this.resetRow.visible = this.settingsExist;
        });
    }

    // ----- window frame -------------------------------------------------------------

    _buildWindow() {
        this.titleLabel = label('', {css: ['title-2']});
        this.subtitleLabel = label('', {css: ['dim-label']});
        const heading = vbox(4, [this.titleLabel, this.subtitleLabel]);
        heading.set_margin_top(18);
        heading.set_margin_bottom(12);
        heading.set_margin_start(24);
        heading.set_margin_end(24);

        this.stack = new Gtk.Stack({
            vexpand: true,
            transition_type: Gtk.StackTransitionType.CROSSFADE,
        });

        this.stepLabel = label('', {css: ['dim-label']});
        this.stepLabel.hexpand = true;
        this.backButton = new Gtk.Button({label: '< _Back', use_underline: true});
        this.nextButton = new Gtk.Button({label: '_Next >', use_underline: true, css_classes: ['suggested-action']});
        this.cancelButton = new Gtk.Button({label: '_Cancel', use_underline: true});
        this.backButton.connect('clicked', () => this._back());
        this.nextButton.connect('clicked', () => this._next());
        this.cancelButton.connect('clicked', () => this._cancel());

        const buttons = new Gtk.Box({spacing: 8});
        for (const w of [this.stepLabel, this.backButton, this.nextButton, this.cancelButton])
            buttons.append(w);
        buttons.set_margin_top(12);
        buttons.set_margin_bottom(12);
        buttons.set_margin_start(24);
        buttons.set_margin_end(24);

        const content = vbox(0, [heading, new Gtk.Separator(), this.stack, new Gtk.Separator(), buttons]);
        const toolbar = new Adw.ToolbarView({content});
        toolbar.add_top_bar(new Adw.HeaderBar({title_widget: new Adw.WindowTitle({title: 'sourceglance Setup'})}));

        this.window = new Adw.ApplicationWindow({
            application: this.app,
            title: 'sourceglance Setup',
            default_width: 680,
            default_height: 560,
            content: toolbar,
        });
        this.window.set_default_widget(this.nextButton);
        this.window.connect('close-request', () => {
            if (this.finished)
                return false;
            if (!this.busy)
                this._cancel();
            return true;
        });

        const shortcuts = new Gtk.ShortcutController();
        shortcuts.add_shortcut(new Gtk.Shortcut({
            trigger: Gtk.ShortcutTrigger.parse_string('Escape'),
            action: Gtk.CallbackAction.new(() => {
                if (!this.busy && !this.finished)
                    this._cancel();
                return true;
            }),
        }));
        this.window.add_controller(shortcuts);
    }

    present() {
        this.window.present();
    }

    _page(id, widget) {
        const scroller = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            child: widget,
        });
        widget.set_margin_top(18);
        widget.set_margin_bottom(18);
        widget.set_margin_start(24);
        widget.set_margin_end(24);
        this.stack.add_named(scroller, id);
    }

    // ----- pages --------------------------------------------------------------------

    _buildPages() {
        this.pages = {
            welcome: {
                title: 'Welcome to sourceglance Setup',
                subtitle: `This wizard installs sourceglance ${this.version}.`,
            },
            license: {title: 'License Agreement', subtitle: 'Please read the following license carefully.'},
            risks: {title: 'Before You Install', subtitle: 'Please review what Setup will do.'},
            options: {title: 'Setup Options', subtitle: 'Choose how sourceglance is installed.'},
            check: {title: 'System Check', subtitle: 'Setup is checking that your computer can run sourceglance.'},
            ready: {title: 'Ready to Install', subtitle: 'Click Install to begin.'},
            progress: {title: 'Installing sourceglance', subtitle: 'Please wait while Setup works.'},
            done: {title: 'Completed', subtitle: ''},
            maintenance: {title: 'Program Maintenance', subtitle: 'Choose what you want to do.'},
            'remove-options': {title: 'Remove Options', subtitle: 'Choose what else to remove.'},
            'ready-remove': {title: 'Ready to Remove', subtitle: 'Click Remove to begin.'},
            removed: {title: 'Removed', subtitle: ''},
            failed: {title: 'Setup Failed', subtitle: ''},
        };

        // Welcome
        const icon = new Gtk.Image({pixel_size: 64, halign: Gtk.Align.START});
        const iconFile = GLib.build_filenamev([PAYLOAD_DIR, 'sourceglance-setup.svg']);
        if (GLib.file_test(iconFile, GLib.FileTest.EXISTS))
            icon.set_from_file(iconFile);
        else
            icon.icon_name = 'system-software-install-symbolic';
        const welcomeText = this.mode === 'upgrade'
            ? `Setup will upgrade sourceglance ${this.installed} to ${this.version}.`
            : 'Setup will install sourceglance, which shows your GitHub issues and pull requests in the GNOME top bar.';
        this._page('welcome', vbox(18, [
            icon,
            label(`<b>Welcome to the sourceglance ${esc(this.version)} Setup Wizard</b>`, {markup: true, css: ['title-4']}),
            label(welcomeText),
            label('Click Next to continue, or Cancel to exit Setup.', {css: ['dim-label']}),
        ]));

        // License
        const banner = label('<b>sourceglance is provided AS IS, without warranty of any kind. You use it at your own risk.</b>',
            {markup: true, css: ['warning']});
        const text = new Gtk.TextView({
            editable: false, cursor_visible: false, wrap_mode: Gtk.WrapMode.WORD,
            top_margin: 10, bottom_margin: 10, left_margin: 10, right_margin: 10,
        });
        text.buffer.set_text(reflow(licenseText()), -1);
        const textScroll = new Gtk.ScrolledWindow({child: text, min_content_height: 200, vexpand: true, has_frame: true});
        this.acceptRadio = new Gtk.CheckButton({label: 'I _accept the terms in the License Agreement', use_underline: true});
        const declineRadio = new Gtk.CheckButton({
            label: 'I _do not accept the terms in the License Agreement', use_underline: true,
            group: this.acceptRadio, active: true,
        });
        this.acceptRadio.connect('toggled', () => this._update());
        declineRadio.connect('toggled', () => this._update());
        this._page('license', vbox(12, [
            banner, textScroll,
            new Gtk.LinkButton({uri: LICENSE_URL, label: 'View the license online', halign: Gtk.Align.START}),
            this.acceptRadio, declineRadio,
        ]));

        // Before you install
        this._page('risks', vbox(12, [
            bullets([
                'sourceglance is pre-release software.',
                'GNOME Shell extensions run inside your desktop. A bug can freeze or crash your session, and you could lose unsaved work.',
                'sourceglance is installed only for your user account. No administrator password is needed.',
                `Setup copies files to ${tildify(extensionDir())} and turns sourceglance on for your next login. Nothing else on your computer is changed.`,
                'If you sign in to GitHub later, your token is stored in your GNOME keyring and sent only to GitHub.',
            ]),
        ]));

        // Options
        const forMe = new Gtk.CheckButton({active: true, valign: Gtk.Align.CENTER});
        const forAll = new Gtk.CheckButton({group: forMe, sensitive: false, valign: Gtk.Align.CENTER});
        const meRow = new Adw.ActionRow({title: 'Only for me', subtitle: 'Recommended', activatable_widget: forMe});
        meRow.add_prefix(forMe);
        const allRow = new Adw.ActionRow({title: 'Everyone on this computer', subtitle: 'Not supported yet', sensitive: false});
        allRow.add_prefix(forAll);
        const installFor = new Adw.PreferencesGroup({title: 'Install for'});
        installFor.add(meRow);
        installFor.add(allRow);

        const locationRow = new Adw.ActionRow({title: 'Location', subtitle: tildify(extensionDir()), subtitle_selectable: true});
        this.enableRow = new Adw.SwitchRow({title: 'Turn on sourceglance after installation', active: true});
        this.resetRow = new Adw.SwitchRow({
            title: 'Reset sourceglance settings from a previous installation', active: false, visible: false,
        });
        const settingsGroup = new Adw.PreferencesGroup({title: 'Installation'});
        for (const row of [locationRow, this.enableRow, this.resetRow])
            settingsGroup.add(row);
        this._page('options', vbox(18, [installFor, settingsGroup]));

        // System check
        this.checkList = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list']});
        this.checkSpinner = new Gtk.Box({spacing: 12});
        this.checkSpinner.append(new Gtk.Spinner({spinning: true}));
        this.checkSpinner.append(label('Checking your system…'));
        this._page('check', vbox(12, [this.checkSpinner, this.checkList]));

        // Ready (install / remove)
        this.readyIntro = label('');
        this.readyList = label('', {markup: true});
        this._page('ready', vbox(12, [this.readyIntro, this.readyList]));
        this.readyRemoveList = label('', {markup: true});
        this._page('ready-remove', vbox(12, [label('Setup is ready to remove sourceglance. It will:'), this.readyRemoveList]));

        // Progress
        this.progressStatus = label('Preparing…');
        this.progressBar = new Gtk.ProgressBar();
        const logView = new Gtk.TextView({
            editable: false, cursor_visible: false, monospace: true, wrap_mode: Gtk.WrapMode.WORD_CHAR,
            top_margin: 6, bottom_margin: 6, left_margin: 6, right_margin: 6,
        });
        this.log.listeners.push(line => {
            const buffer = logView.buffer;
            buffer.insert(buffer.get_end_iter(), `${line}\n`, -1);
        });
        const details = new Gtk.Expander({
            label: 'Show _details', use_underline: true,
            child: new Gtk.ScrolledWindow({child: logView, min_content_height: 140, has_frame: true}),
        });
        this._page('progress', vbox(12, [this.progressStatus, this.progressBar, details]));

        // Completed
        this.logoutCheck = new Gtk.CheckButton({label: '_Log out now to start sourceglance', use_underline: true});
        this.doneText = label('Log out and back in to start it. Then click the sourceglance icon in the top bar and choose Settings to sign in to GitHub.');
        this._page('done', vbox(18, [
            label(`<b>sourceglance ${esc(this.version)} has been installed.</b>`, {markup: true, css: ['title-4']}),
            this.doneText,
            this.logoutCheck,
        ]));

        // Maintenance
        const maintenanceIntro = this.mode === 'downgrade'
            ? `<b>A newer version of sourceglance (${esc(this.installed)}) is installed.</b> This setup contains ${esc(this.version)}. Downgrading may lose settings added in newer versions.`
            : `sourceglance ${esc(this.installed ?? '')} is already installed.`;
        const first = this.mode === 'downgrade'
            ? {id: 'downgrade', label: `_Downgrade to ${this.version}`, detail: 'Replace the installed version with this one.'}
            : {id: 'repair', label: '_Repair', detail: 'Reinstall sourceglance to fix missing or damaged files. Settings and your saved token are kept.'};
        const firstRadio = new Gtk.CheckButton({label: first.label, use_underline: true, active: this.choice === first.id});
        const removeRadio = new Gtk.CheckButton({
            label: 'Re_move', use_underline: true, group: firstRadio, active: this.choice === 'remove',
        });
        const onChoice = () => {
            this.choice = firstRadio.active ? first.id : removeRadio.active ? 'remove' : null;
            if (this.choice)
                this.flow = flowFor(this.mode, this.choice);
            this._update();
        };
        firstRadio.connect('toggled', onChoice);
        removeRadio.connect('toggled', onChoice);
        this._page('maintenance', vbox(12, [
            label(maintenanceIntro, {markup: true, css: this.mode === 'downgrade' ? ['warning'] : []}),
            firstRadio, label(first.detail, {css: ['dim-label']}),
            removeRadio, label('Uninstall sourceglance from your account.', {css: ['dim-label']}),
        ]));

        // Remove options
        this.deleteTokenCheck = new Gtk.CheckButton({label: 'Also delete my saved GitHub _token from the keyring', use_underline: true});
        this.resetOnRemoveCheck = new Gtk.CheckButton({label: 'Also reset sourceglance _settings', use_underline: true});
        this._page('remove-options', vbox(12, [
            label(`A backup copy of the extension is kept in ${tildify(backupsDir())}.`, {css: ['dim-label']}),
            this.deleteTokenCheck, this.resetOnRemoveCheck,
        ]));

        // Removed
        this.logoutAfterRemove = new Gtk.CheckButton({label: '_Log out now to finish', use_underline: true});
        this._page('removed', vbox(18, [
            label('<b>sourceglance has been removed.</b>', {markup: true, css: ['title-4']}),
            label('Log out and back in to finish. You can install it again at any time with this Setup.'),
            this.logoutAfterRemove,
        ]));

        // Failed
        this.failedReason = label('', {selectable: true});
        this.failedRollback = label('');
        this._page('failed', vbox(12, [
            label('<b>Setup couldn’t finish.</b>', {markup: true, css: ['title-4']}),
            this.failedReason, this.failedRollback,
            label(`The full log is in ${tildify(this.log.path)}.`, {css: ['dim-label'], selectable: true}),
            new Gtk.LinkButton({uri: REPORT_URL, label: 'Report a problem', halign: Gtk.Align.START}),
        ]));

        this.pages.ready.title = {maintain: 'Ready to Repair', downgrade: 'Ready to Downgrade'}[this.mode] ?? 'Ready to Install';
        this.pages.ready.subtitle = `Click ${{maintain: 'Repair', downgrade: 'Downgrade'}[this.mode] ?? 'Install'} to begin.`;
    }

    // ----- navigation ---------------------------------------------------------------

    get _id() {
        return this.flow[this.index];
    }

    _isResult(id = this._id) {
        return ['done', 'removed', 'failed'].includes(id);
    }

    _show(index, id = null) {
        this.index = index;
        const pageId = id ?? this.flow[index];
        this.currentId = pageId;
        this.stack.visible_child_name = pageId;
        const page = this.pages[pageId];
        this.titleLabel.label = page.title;
        this.subtitleLabel.label = page.subtitle;
        this.subtitleLabel.visible = page.subtitle !== '';
        this._enter(pageId);
        this._update();
    }

    _enter(id) {
        if (id === 'check')
            this._runChecks();
        else if (id === 'ready')
            this._fillReady();
        else if (id === 'ready-remove')
            this._fillReady();
        else if (id === 'progress')
            this._runOperation();
    }

    _canNext() {
        switch (this.currentId) {
        case 'license': return this.acceptRadio.active;
        case 'check': return this.checks !== null && allChecksPass(this.checks);
        case 'maintenance': return this.choice !== null;
        case 'progress': return false;
        default: return true;
        }
    }

    _update() {
        const id = this.currentId;
        const result = this._isResult(id);
        const total = this.flow.length - 1;
        this.stepLabel.label = result || id === 'progress' ? '' : `Step ${this.index + 1} of ${total}`;

        this.backButton.visible = !result;
        this.backButton.sensitive = this.index > 0 && !this.busy;
        this.cancelButton.visible = !result;
        this.cancelButton.sensitive = !this.busy;

        const nextLabels = {
            ready: this.mode === 'maintain' ? '_Repair' : this.mode === 'downgrade' ? '_Downgrade' : '_Install',
            'ready-remove': '_Remove',
            done: '_Finish', removed: '_Finish', failed: '_Close',
        };
        this.nextButton.label = nextLabels[id] ?? '_Next >';
        if (id === 'ready-remove') {
            this.nextButton.remove_css_class('suggested-action');
            this.nextButton.add_css_class('destructive-action');
        } else {
            this.nextButton.remove_css_class('destructive-action');
            this.nextButton.add_css_class('suggested-action');
        }
        this.nextButton.sensitive = this._canNext() && !this.busy;
    }

    _back() {
        if (this.index > 0 && !this.busy)
            this._show(this.index - 1);
    }

    _next() {
        if (!this._canNext() || this.busy)
            return;
        if (this._isResult(this.currentId)) {
            this._finish();
            return;
        }
        this._show(this.index + 1);
    }

    _cancel() {
        const dialog = new Adw.AlertDialog({
            heading: 'Exit sourceglance Setup?',
            body: 'Nothing has been changed.',
        });
        dialog.add_response('stay', '_Continue Setup');
        dialog.add_response('exit', '_Exit Setup');
        dialog.set_response_appearance('exit', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('stay');
        dialog.set_close_response('stay');
        dialog.connect('response', (_d, response) => {
            if (response === 'exit')
                this._quit(EXIT.CANCELLED);
        });
        dialog.present(this.window);
    }

    _quit(code) {
        this.exitCode = code;
        this.finished = true;
        this.log.close();
        this.window.close();
    }

    _finish() {
        const wantsLogout = (this.currentId === 'done' && this.logoutCheck.active) ||
            (this.currentId === 'removed' && this.logoutAfterRemove.active);
        const code = this.currentId === 'failed' ? EXIT.FAILED : EXIT.OK;
        if (!wantsLogout) {
            this._quit(code);
            return;
        }
        const dialog = new Adw.AlertDialog({
            heading: 'Log out now?',
            body: 'Save your work first — open apps will close.',
        });
        dialog.add_response('cancel', '_Cancel');
        dialog.add_response('logout', '_Log Out');
        dialog.set_response_appearance('logout', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_d, response) => {
            if (response !== 'logout')
                return;
            run(['gnome-session-quit', '--logout', '--no-prompt']).finally(() => this._quit(code));
        });
        dialog.present(this.window);
    }

    // ----- page actions -------------------------------------------------------------

    async _runChecks() {
        this.checks = null;
        this.checkSpinner.visible = true;
        this.checkList.remove_all();
        this._update();
        const facts = await gatherFacts();
        this.checks = evaluateChecks(facts, this.shellVersions, this.version);
        this.checkSpinner.visible = false;
        for (const check of this.checks) {
            const row = new Adw.ActionRow({title: check.title, subtitle: check.ok ? '' : check.message});
            row.add_prefix(new Gtk.Image({
                icon_name: check.ok ? 'object-select-symbolic' : 'dialog-error-symbolic',
                css_classes: [check.ok ? 'success' : 'error'],
            }));
            if (!check.ok && check.fix === 'enable-user-extensions') {
                const fix = new Gtk.Button({label: '_Turn On', use_underline: true, valign: Gtk.Align.CENTER});
                fix.connect('clicked', () => {
                    setUserExtensionsEnabled();
                    this.log.write('Turned on user extensions');
                    this._runChecks();
                });
                row.add_suffix(fix);
            }
            this.checkList.append(row);
        }
        this.log.write(`System check: ${this.checks.map(c => `${c.id}=${c.ok ? 'ok' : 'fail'}`).join(' ')}`);
        this._update();
    }

    _fillReady() {
        const lines = readySummary({
            mode: this.mode, choice: this.choice, packageVersion: this.version,
            installedVersion: this.installed, enableAfter: this.enableRow.active,
            extensionDir: tildify(extensionDir()),
        });
        if (this.deleteTokenCheck.active)
            lines.push('Delete your saved GitHub token from the keyring');
        if (this.resetOnRemoveCheck.active)
            lines.push('Reset sourceglance settings');
        const markup = lines.map(l => `•  ${esc(l)}`).join('\n');
        this.readyIntro.label = 'Setup is ready. It will:';
        this.readyList.label = markup;
        this.readyRemoveList.label = markup;
    }

    async _runOperation() {
        this.busy = true;
        this._update();
        const removing = operationFor(this.mode, this.choice) === 'remove';
        this.titleLabel.label = removing ? 'Removing sourceglance' : 'Installing sourceglance';
        const progress = (fraction, status) => {
            this.progressBar.fraction = fraction;
            this.progressStatus.label = status;
        };
        try {
            if (removing) {
                await remove({
                    deleteToken: this.deleteTokenCheck.active, reset: this.resetOnRemoveCheck.active,
                    log: this.log, progress,
                });
            } else {
                const {restarted} = await install({
                    enableAfter: this.enableRow.active, reset: this.resetRow.active,
                    log: this.log, progress,
                });
                if (restarted) {
                    this.doneText.label = 'sourceglance is running the new version now, with your settings and sign-ins. There’s no need to log out.';
                    this.logoutCheck.active = false;
                    this.logoutCheck.visible = false;
                }
            }
            this.busy = false;
            this._show(this.index + 1);
        } catch (e) {
            this.busy = false;
            this.failedReason.label = e.message;
            this.failedRollback.label = e.rolledBack
                ? 'Your previous version of sourceglance was restored.'
                : 'No changes were kept.';
            this._show(this.index, 'failed');
        }
    }
}

/** Open the wizard; resolves to the exit code. */
export function runWizard(opts) {
    Adw.init();
    const app = new Adw.Application({
        application_id: 'io.github.omer_gh.SourceglanceSetup',
        flags: Gio.ApplicationFlags.NON_UNIQUE,
    });
    let wizard = null;
    app.connect('activate', () => {
        wizard = new Wizard(app, {
            preselect: {repair: 'repair', uninstall: 'remove'}[opts.action] ?? null,
            logFile: opts.logFile,
        });
        wizard.present();
    });
    app.run([]);
    return wizard?.exitCode ?? EXIT.FAILED;
}
