/** 设置页：云端凭证入口、dark mode、图片清理与数据清空。 */
import { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  Flex,
  Icon,
  Input,
  Spinner,
  Switch,
  Text,
} from "@chakra-ui/react";
import { useAtom } from "jotai";
import { credentialAtom, syncBusyAtom } from "../../features/cloud/state";
import { colorModeAtom } from "../../features/preferences/state";
import { toaster } from "../../features/notifications/toaster";
import { CredentialModal } from "../../features/cloud/credential/credential-modal";
import { getCredential, hasCredential } from "../../features/cloud/credential/credential";
import { cleanupCloudImages } from "../../features/cloud/cleanup";
import type { R2Config } from "../../features/cloud/cloud.type";
import { clearAllData, currentCloud, storage } from "../runtime";
import { useNavigate } from "@tanstack/react-router";
import { LuChevronRight } from "react-icons/lu";
import type {
  SectionProps,
  SettingsActionRowProps,
  SettingsRowProps,
} from "./settings.type";

function Section({ title, children }: SectionProps) {
  return (
    <Flex direction="column" gap="xs">
      <Text px="xs" textStyle="xs" fontWeight="semibold" color="fg.muted">
        {title}
      </Text>
      <Box bg="bg.panel" rounded="lg" overflow="hidden">
        {children}
      </Box>
    </Flex>
  );
}

function SettingsRow({ label, children }: SettingsRowProps) {
  return (
    <Flex
      align="center"
      justify="space-between"
      gap="md"
      px="md"
      minH="16"
      borderBottomWidth="1px"
      borderColor="border.subtle"
      _last={{ borderBottomWidth: "0" }}
    >
      <Flex direction="column" gap="2xs" minW="0">
        <Text textStyle="sm" fontWeight="medium">
          {label}
        </Text>
      </Flex>
      <Box flexShrink={0}>{children}</Box>
    </Flex>
  );
}

function SettingsActionRow({
  label,
  disabled,
  onClick,
}: SettingsActionRowProps) {
  return (
    <Button
      width="full"
      size="2xl"
      px="md"
      textStyle="sm"
      variant="plain"
      justifyContent="space-between"
      borderRadius="0"
      borderBottomWidth="1px"
      borderColor="border.subtle"
      _last={{ borderBottomWidth: "0" }}
      disabled={disabled}
      onClick={onClick}
    >
      <Text textStyle="sm" fontWeight="medium">
        {label}
      </Text>
      <Icon as={LuChevronRight} boxSize="5" color="fg.subtle" />
    </Button>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const [credential] = useAtom(credentialAtom);
  const [colorMode, setColorModeAtom] = useAtom(colorModeAtom);
  const [modalOpen, setModalOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [resetConfig, setResetConfig] = useState<R2Config>();
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useAtom(syncBusyAtom);
  const configured = hasCredential(credential);

  async function handleCleanup() {
    if (syncBusy || resetBusy || cleanupBusy) return;
    const cloud = currentCloud();
    if (!cloud) {
      toaster.create({ title: "请先配置云端凭证", type: "error" });
      setCleanupOpen(false);
      return;
    }
    setCleanupBusy(true);
    try {
      const deleted = await cleanupCloudImages(storage, cloud);
      toaster.create({
        title:
          deleted > 0
            ? "已删除 " + deleted + " 张无引用图片"
            : "没有需要清理的图片",
        type: "success",
      });
    } catch (err) {
      toaster.create({
        title:
          "清理失败：" + (err instanceof Error ? err.message : String(err)),
        type: "error",
      });
    } finally {
      setCleanupBusy(false);
      setCleanupOpen(false);
    }
  }

  function openReset() {
    const config = getCredential();
    if (!config || !hasCredential(config)) return;
    setResetConfirmation("");
    setResetConfig(config);
  }

  async function handleResetData() {
    if (!resetConfig || resetConfirmation !== resetConfig.bucket || resetBusy || syncBusy || cleanupBusy) return;
    setResetBusy(true);
    setSyncBusy(true);
    try {
      await clearAllData(resetConfig);
      // 刷新整个应用，避免记录页的 keep-alive 列表和图片内存缓存仍显示旧数据。
      window.location.reload();
    } catch (error) {
      setResetBusy(false);
      setSyncBusy(false);
      toaster.create({
        title: "清空失败，请重试：" + (error instanceof Error ? error.message : String(error)),
        type: "error",
      });
    }
  }

  return (
    <Box flex="1" minH="0" overflowY="auto" px="md" py="md">
      <Flex direction="column" gap="xl">
        <Section title="云端">
          <SettingsActionRow
            label="云端凭证"
            onClick={() => setModalOpen(true)}
          />
          <SettingsActionRow
            label="清理未引用图片"
            disabled={!configured || cleanupBusy || syncBusy || resetBusy}
            onClick={() => setCleanupOpen(true)}
          />
        </Section>

        <Section title="记录">
          <SettingsActionRow
            label="类型模板"
            onClick={() => void navigate({ to: "/settings/type-templates" })}
          />
          <SettingsActionRow
            label="清空数据"
            disabled={!configured || cleanupBusy || syncBusy || resetBusy}
            onClick={openReset}
          />
        </Section>

        <Section title="外观">
          <SettingsRow label="深色模式">
            <Switch.Root
              size="lg"
              checked={colorMode === "dark"}
              onCheckedChange={(e) => {
                const mode = e.checked ? "dark" : "light";
                setColorModeAtom(mode);
              }}
            >
              <Switch.HiddenInput aria-label="深色模式" />
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Root>
          </SettingsRow>
        </Section>
      </Flex>

      <CredentialModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <Dialog.Root
        open={cleanupOpen}
        onOpenChange={(e) => {
          if (!cleanupBusy) setCleanupOpen(e.open);
        }}
        onEscapeKeyDown={(e) => {
          if (cleanupBusy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (cleanupBusy) e.preventDefault();
        }}
      >
        <Dialog.Backdrop />
        <Dialog.Positioner alignItems="center" justifyContent="center">
          <Dialog.Content
            width="calc(100% - 2rem)"
            maxW="sm"
            aria-busy={cleanupBusy}
          >
            <Dialog.Header>
              <Dialog.Title textStyle="md">清理未引用图片</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Text textStyle="sm">
                是否确认删除云端未被任何记录引用的图片？
              </Text>
            </Dialog.Body>
            <Dialog.Footer>
              <Flex width="full" gap="sm">
                <Button
                  flex="1"
                  variant="plain"
                  disabled={cleanupBusy}
                  onClick={() => setCleanupOpen(false)}
                >
                  取消
                </Button>
                <Button flex="1" disabled={cleanupBusy} onClick={handleCleanup}>
                  {cleanupBusy ? <Spinner size="sm" /> : "删除"}
                </Button>
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      <Dialog.Root
        open={resetConfig !== undefined}
        onOpenChange={(event) => {
          if (!resetBusy && !event.open) setResetConfig(undefined);
        }}
        onEscapeKeyDown={(event) => {
          if (resetBusy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (resetBusy) event.preventDefault();
        }}
      >
        <Dialog.Backdrop />
        <Dialog.Positioner alignItems="center" justifyContent="center">
          <Dialog.Content width="calc(100% - 2rem)" maxW="sm" maxH="90dvh" aria-busy={resetBusy}>
            <Dialog.Header>
              <Dialog.Title textStyle="md">清空数据</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body overflowY="auto">
              <Flex direction="column" gap="md">
                <Text textStyle="sm">将清除所有本地及云端数据</Text>
                <Flex direction="column" gap="xs" textStyle="sm" color="fg.muted">
                  <Text overflowWrap="anywhere">端点：{resetConfig?.endpoint}</Text>
                  <Text overflowWrap="anywhere">桶名：{resetConfig?.bucket}</Text>
                </Flex>
                <Input
                  aria-label="桶名"
                  placeholder="输入桶名以确认"
                  value={resetConfirmation}
                  disabled={resetBusy}
                  autoComplete="off"
                  onChange={(event) => setResetConfirmation(event.target.value)}
                />
              </Flex>
            </Dialog.Body>
            <Dialog.Footer>
              <Flex width="full" gap="sm">
                <Button flex="1" variant="plain" disabled={resetBusy} onClick={() => setResetConfig(undefined)}>
                  取消
                </Button>
                <Button
                  flex="1"
                  colorPalette="red"
                  disabled={!resetConfig || resetConfirmation !== resetConfig.bucket || resetBusy || syncBusy || cleanupBusy}
                  onClick={handleResetData}
                >
                  {resetBusy ? <Spinner size="sm" /> : "确认"}
                </Button>
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </Box>
  );
}
