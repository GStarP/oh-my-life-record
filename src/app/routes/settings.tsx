/** 设置页：云端凭证入口、dark mode、清理未引用图片。 */
import { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  Flex,
  Icon,
  Spinner,
  Switch,
  Text,
} from "@chakra-ui/react";
import { useAtom } from "jotai";
import { credentialAtom } from "../../features/cloud/state";
import { colorModeAtom } from "../../features/preferences/state";
import { toaster } from "../../features/notifications/toaster";
import { CredentialModal } from "../../features/cloud/credential/credential-modal";
import { hasCredential } from "../../features/cloud/credential/credential";
import { cleanupCloudImages } from "../../features/cloud/cleanup";
import { currentCloud, storage } from "../runtime";
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
  const configured = hasCredential(credential);

  async function handleCleanup() {
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
            disabled={!configured || cleanupBusy}
            onClick={() => setCleanupOpen(true)}
          />
        </Section>

        <Section title="记录">
          <SettingsActionRow
            label="类型模板"
            onClick={() => void navigate({ to: "/settings/type-templates" })}
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
    </Box>
  );
}
