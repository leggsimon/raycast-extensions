import * as os from "os";
import path from "path";
import { useState } from "react";

import {
  Action,
  ActionPanel,
  Application,
  Color,
  environment,
  Form,
  getApplications,
  getPreferenceValues,
  Icon,
  Keyboard,
  showToast,
  useNavigation,
} from "@raycast/api";
import { getFavicon } from "@raycast/utils";

import { KEYBOARD_SHORTCUT, Visibility } from "../lib/constants";
import { useGroups } from "../lib/Groups";
import { iconMap } from "../lib/icons";
import { createNewPin, getPins, getPinStatistics, modifyPin, Pin } from "../lib/Pins";
import { ExtensionPreferences } from "../lib/preferences";
import CopyPinActionsSubmenu from "./actions/CopyPinActionsSubmenu";
import DeletePinAction from "./actions/DeletePinAction";
import { PLApplicator } from "placeholders-toolkit";
import PinsPlaceholders from "../lib/placeholders";

/**
 * Form for creating/editing a new pin.
 * @param props.pin The pin to edit.
 * @param props.setPins The function to call to update the list of pins.
 * @param props.pins The list of all pins.
 * @returns A form view component.
 */
export const PinForm = (props: { pin?: Pin; setPins?: React.Dispatch<React.SetStateAction<Pin[]>>; pins?: Pin[] }) => {
  const { pin, setPins, pins } = props;
  const { groups } = useGroups();
  const { pop } = useNavigation();
  const [applications, setApplications] = useState<Application[]>([]);
  const [placeholderTooltip, setPlaceholderTooltip] = useState<string>("");
  const [urlError, setUrlError] = useState<string | undefined>();
  const [shortcutError, setShortcutError] = useState<string | undefined>();
  const [values, setValues] = useState<Record<string, unknown>>({
    url: pin ? pin.url : undefined,
    icon: pin ? pin.icon : undefined,
    iconColor: pin ? pin.iconColor : undefined,
    isFragment: pin && pin.fragment ? true : false,
    application: pin ? pin.application : undefined,
  });

  const iconList = Object.keys(Icon);
  iconList.unshift("Favicon / File Icon");
  iconList.unshift("None");

  const preferences = getPreferenceValues<ExtensionPreferences>();

  /**
   * Get the list of applications that can be used to open the target.
   * @param target The target to open.
   * @returns A tuple containing the preferred application and the list of all relevant applications.
   */
  const getMatchingApplications = async (target: string): Promise<[string, Application[]]> => {
    let [app, apps] = [values.application as string, [] as Application[]];
    try {
      apps = await getApplications(target);
      if (!apps.find((app) => app.name === "Terminal")) {
        apps.push({
          name: "Terminal",
          path: "/System/Applications/Utilities/Terminal.app",
          bundleId: "com.apple.Terminal",
        });
      }
    } catch (error) {
      const allApplications = await getApplications();
      if (target.match(/^[a-zA-Z0-9]*?:.*/g)) {
        // Target is URL-like, so use the preferred browser if one is set
        const preferredBrowser = preferences.preferredBrowser ? preferences.preferredBrowser : { name: "Safari" };
        const browser = allApplications.find((app) => app.name == preferredBrowser.name);
        if (browser) {
          apps = [browser, ...allApplications.filter((app) => app.name != preferredBrowser.name)];
          if (app == undefined || app == "None") {
            app = browser.path;
          }
        } else {
          apps = allApplications;
        }
      } else {
        app = "None";
        apps = allApplications;
      }
    }
    setApplications(apps);
    return [app, apps];
  };

  /**
   * Update the placeholder tooltip based on the current target.
   * @param target The target to check for placeholders.
   */
  const updatePlaceholderTooltip = async (target: string) => {
    let detectedPlaceholders = await PLApplicator.checkForPlaceholders(target, { allPlaceholders: PinsPlaceholders });
    detectedPlaceholders = detectedPlaceholders.filter(
      (placeholder) =>
        target.match(placeholder.regex) != undefined ||
        target.match(new RegExp(`(?<![a-zA-z])${placeholder.name.replaceAll("+", "\\+")}(?! ?[a-zA-z])`)) != undefined,
    );
    setPlaceholderTooltip(
      detectedPlaceholders.length > 0
        ? `\n\nDetected Placeholders:\n${detectedPlaceholders
            .map(
              (placeholder) =>
                `${placeholder.hintRepresentation}: ${placeholder.description}\nExample: ${placeholder.example}`,
            )
            .join("\n\n")}`
        : "",
    );
  };

  return (
    <Form
      navigationTitle={pin ? `Edit Pin: ${pin.name}` : "New Pin"}
      searchBarAccessory={
        <Form.LinkAccessory
          text="Placeholders Guide"
          target={`file://${path.resolve(environment.assetsPath, "placeholders_guide.md")}`}
        />
      }
      actions={
        <ActionPanel>
          <Action.SubmitForm
            icon={Icon.ChevronRight}
            onSubmit={async (values) => {
              const shortcut = { modifiers: values.modifiersField, key: values.keyField };

              if (values.modifiersField.length > 0) {
                // Check if the shortcut is reserved by the extension
                const reservedShortcut = Object.entries(KEYBOARD_SHORTCUT).find(
                  ([, reservedShortcut]) =>
                    shortcut.modifiers.every((modifier: Keyboard.KeyModifier) =>
                      reservedShortcut.modifiers.includes(modifier),
                    ) && reservedShortcut.key == shortcut.key,
                );
                if (reservedShortcut) {
                  setShortcutError(`This shortcut is reserved by the extension! (${reservedShortcut[0]})`);
                  return false;
                }

                // Check if the shortcut is already in use by another pin
                const usedShortcut = pins?.find(
                  (pin) =>
                    pin.shortcut?.modifiers.every((modifier) => shortcut.modifiers.includes(modifier)) &&
                    pin.shortcut?.key == shortcut.key,
                );
                if (usedShortcut && (!pin || usedShortcut.id != pin.id)) {
                  setShortcutError(`This shortcut is already in use by another pin! (${usedShortcut.name})`);
                  return false;
                }
              }

              if (pin && setPins) {
                await modifyPin(
                  pin,
                  values.nameField,
                  values.urlField,
                  values.iconField,
                  values.groupField || "None",
                  values.openWithField,
                  values.dateField,
                  values.execInBackgroundField,
                  values.fragmentField,
                  values.modifiersField.length ? { modifiers: values.modifiersField, key: values.keyField } : undefined,
                  pin.lastOpened ? new Date(pin.lastOpened) : undefined,
                  pin.timesOpened,
                  pin.dateCreated ? new Date(pin.dateCreated) : new Date(),
                  values.iconColorField,
                  (values.tagsField as string)
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0),
                  values.notesField,
                  values.tooltipField,
                  pin.averageExecutionTime,
                  values.visibilityField,
                  pop,
                  setPins,
                );
              } else {
                await createNewPin(
                  values.nameField || values.urlField.substring(0, 50),
                  values.urlField,
                  values.iconField,
                  values.groupField || "None",
                  values.openWithField,
                  values.dateField,
                  values.execInBackgroundField,
                  values.fragmentField,
                  { modifiers: values.modifiersField, key: values.keyField },
                  values.iconColorField,
                  (values.tagsField as string)
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0),
                  values.notesField,
                  values.visibilityField,
                );
                if (setPins) {
                  setPins(await getPins());
                }
                await showToast({ title: `Added pin for "${values.nameField}"` });
                pop();
              }
            }}
          />
          <Action.Open
            title="Open Placeholders Guide"
            icon={Icon.Info}
            target={path.resolve(environment.assetsPath, "placeholders_guide.md")}
            shortcut={{ modifiers: ["cmd"], key: "g" }}
          />
          {pin && setPins ? <DeletePinAction pin={pin} setPins={setPins} pop={pop} /> : null}
          {pin && pins ? <CopyPinActionsSubmenu pin={pin} pins={pins} /> : null}
        </ActionPanel>
      }
    >
      <Form.TextField
        id="nameField"
        title="Pin Name"
        placeholder="Enter pin name, e.g. Google, or leave blank to use target"
        info="The name of the pin as it will appear in the list/menu. If left blank, the first 50 characters of the target (prior to placeholder substitution) will be used as the name."
        defaultValue={pin ? pin.name : undefined}
      />

      <Form.TextArea
        id="urlField"
        title="Target"
        placeholder="Filepath, URL, or Terminal command to pin"
        info={`The target URL, path, script, or text of the pin. Placeholders can be used to insert dynamic values into the target. See the Placeholders Guide (⌘G) for more information.${placeholderTooltip}`}
        error={urlError}
        onChange={async (value) => {
          if (value.startsWith("~")) {
            value = value.replace("~", os.homedir());
          }

          const [app] = await getMatchingApplications(value);
          await updatePlaceholderTooltip(value);
          setValues({ ...values, url: value, application: app });

          if (urlError !== undefined) {
            setUrlError(undefined);
          }
        }}
        onBlur={(event) => {
          if (event.target.value?.length == 0) {
            setUrlError("Target cannot be empty!");
          } else if (urlError !== undefined) {
            setUrlError(undefined);
          }
        }}
        defaultValue={pin ? pin.url : undefined}
      />

      <Form.Checkbox
        label="Treat as Text Fragment"
        id="fragmentField"
        info="If checked, the target will be treated as a text fragment, regardless of its format. Text fragments are copied to the clipboard when the pin is opened."
        onChange={(value) => setValues({ ...values, isFragment: value })}
        defaultValue={pin ? pin.fragment : false}
      />

      {!values.isFragment &&
      (values.url as string)?.length != 0 &&
      !(values.url as string)?.startsWith("/") &&
      !(values.url as string)?.startsWith("~") &&
      !(values.url as string)?.match(/^[a-zA-Z0-9]*?:.*/g) ? (
        <Form.Checkbox
          label="Execute in Background"
          id="execInBackgroundField"
          defaultValue={pin ? pin.execInBackground : false}
          info="If checked, the pinned Terminal command will be executed in the background instead of in a new Terminal tab."
        />
      ) : null}

      <Form.Dropdown
        id="iconField"
        title="Icon"
        info="The icon displayed next to the pin's name in the list/menu. Favicons and file icons are automatically fetched. When an icon other than Favicon / File Icon is selected, the icon color can be changed (a color field will appear below)."
        defaultValue={pin ? pin.icon : "Favicon / File Icon"}
        onChange={(value) => setValues({ ...values, icon: value })}
      >
        {iconList.map((icon) => {
          const urlIcon = (values.url as string)
            ? (values.url as string).startsWith("/") || (values.url as string).startsWith("~")
              ? { fileIcon: values.url as string }
              : (values.url as string).match(/^[a-zA-Z0-9]*?:.*/g)
                ? getFavicon(values.url as string)
                : Icon.Terminal
            : iconMap["Minus"];

          return (
            <Form.Dropdown.Item
              key={icon}
              title={icon}
              value={icon}
              icon={
                icon in iconMap
                  ? { source: iconMap[icon], tintColor: values.iconColor as string }
                  : icon == "Favicon / File Icon"
                    ? urlIcon
                    : iconMap["Minus"]
              }
            />
          );
        })}
      </Form.Dropdown>

      {!values.icon || ["Favicon / File Icon", "None"].includes(values.icon as string) ? null : (
        <Form.Dropdown
          id="iconColorField"
          title="Icon Color"
          info="The color of the Pin's icon when displayed in the list/menu."
          onChange={(value) => setValues({ ...values, iconColor: value })}
          defaultValue={pin?.iconColor ?? Color.PrimaryText}
        >
          {Object.entries(Color).map(([key, color]) => {
            return (
              <Form.Dropdown.Item
                key={key}
                title={key}
                value={color as string}
                icon={{ source: Icon.Circle, tintColor: color }}
              />
            );
          })}
        </Form.Dropdown>
      )}

      {!values.isFragment ? (
        <Form.Dropdown
          title="Open With"
          id="openWithField"
          info="The application to open the pin with"
          value={values.application ? (values.application as string) : "None"}
          onChange={(value) => {
            setValues({ ...values, application: value });
          }}
        >
          <Form.Dropdown.Item key="None" title="None" value="None" icon={Icon.Minus} />
          {applications.map((app, idx) => {
            return (
              <Form.Dropdown.Item
                key={`app.name${idx}`}
                title={app.name}
                value={app.path}
                icon={{ fileIcon: app.path }}
              />
            );
          })}
        </Form.Dropdown>
      ) : null}

      <Form.Dropdown
        id="visibilityField"
        title="Visibility"
        info="Controls the visibility of the pin in the 'View Pins' command and the menu bar dropdown. If set to 'Hidden', you can find the pin by using the 'Show Hidden Pins' action of the 'View Pins' command. Hidden pins can still be opened using deeplinks, while disabled pins cannot be opened at all."
        defaultValue={(pin ? pin.visibility : Visibility.VISIBLE)?.toString()}
      >
        <Form.Dropdown.Item key="visible" title="Visible" value={Visibility.VISIBLE.toString()} icon={Icon.Eye} />
        <Form.Dropdown.Item
          key="menubarOnly"
          title="Show in Menubar Only"
          value={Visibility.MENUBAR_ONLY.toString()}
          icon={Icon.Window}
        />
        <Form.Dropdown.Item
          key="raycastOnly"
          title="Show in 'View Pins' Only"
          value={Visibility.VIEW_PINS_ONLY.toString()}
          icon={Icon.AppWindowList}
        />
        <Form.Dropdown.Item key="hidden" title="Hidden" value={Visibility.HIDDEN.toString()} icon={Icon.EyeDisabled} />
        <Form.Dropdown.Item
          key="disabled"
          title="Disabled"
          value={Visibility.DISABLED.toString()}
          icon={Icon.XMarkCircle}
        />
      </Form.Dropdown>

      <Form.DatePicker
        id="dateField"
        title="Expiration Date"
        info="The date and time at which the pin will be automatically removed"
        defaultValue={pin && pin.expireDate ? new Date(pin.expireDate) : undefined}
      />

      {groups?.length ? (
        <Form.Dropdown
          id="groupField"
          title="Group"
          defaultValue={pin ? pin.group : "None"}
          info="The group that this Pin is associated with in the 'View Pins' command and in the menu bar dropdown."
        >
          {[{ name: "None", icon: "Minus", id: -1 }].concat(groups).map((group) => {
            return (
              <Form.Dropdown.Item key={group.name} title={group.name} value={group.name} icon={iconMap[group.icon]} />
            );
          })}
        </Form.Dropdown>
      ) : null}

      <Form.TextField
        id="tagsField"
        title="Tags"
        info="The comma-separated list of tags associated with the pin. Tags can be used to filter pins in the 'View Pins' command."
        defaultValue={pin ? pin.tags?.join(", ") : ""}
      />

      <Form.Separator />

      <Form.TextField
        id="tooltipField"
        title="Tooltip"
        info="The tooltip that is displayed when hovering over the pin in the menu bar dropdown."
        defaultValue={pin ? pin.tooltip : undefined}
      />

      <Form.TextArea
        id="notesField"
        title="Notes"
        info="Any additional notes about the pin. Notes are displayed in the 'View Pins' command. Markdown is supported."
        defaultValue={pin ? pin.notes : undefined}
        enableMarkdown={true}
      />

      <Form.Separator />

      <Form.TagPicker
        id="modifiersField"
        title="Keyboard Shortcut Modifiers"
        info="The keyboard modifiers to use for the keyboard shortcut that opens the pin. The combination of modifiers and key must be unique."
        defaultValue={pin ? pin.shortcut?.modifiers : undefined}
        error={shortcutError}
        onChange={() => setShortcutError(undefined)}
      >
        <Form.TagPicker.Item key="cmd" title="Command" value="cmd" />
        <Form.TagPicker.Item key="shift" title="Shift" value="shift" />
        <Form.TagPicker.Item key="ctrl" title="Control" value="ctrl" />
        <Form.TagPicker.Item key="alt" title="Option" value="alt" />
      </Form.TagPicker>

      <Form.TextField
        id="keyField"
        title="Keyboard Shortcut Key"
        info="The keyboard key to use for the keyboard shortcut that opens the pin. The combination of modifiers and key must be unique."
        defaultValue={pin ? pin.shortcut?.key : undefined}
        error={shortcutError}
        onChange={() => setShortcutError(undefined)}
      />

      {pin?.id != undefined ? (
        <>
          <Form.Separator />
          <Form.Description title="Statistics" text={getPinStatistics(pin, pins || []) as string} />
        </>
      ) : null}
    </Form>
  );
};
