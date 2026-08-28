/** 设置中的类型模板管理页。 */
import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Flex,
  Grid,
  Icon,
  IconButton,
  Spinner,
  Text,
} from "@chakra-ui/react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { LuArrowLeft, LuPlus } from "react-icons/lu";
import { storage } from "../runtime";
import { toaster } from "../../features/notifications/toaster";
import { refreshSyncIndicator } from "../sync-indicator";
import { TypeTemplateEditor } from "../../features/type-templates/template-editor";
import {
  typeTemplateDataAtom,
  updateTypeTemplateData,
} from "../../features/type-templates/state";
import { createTypeTemplateWorkflow } from "../../features/type-templates/workflow";
import type { TypeTemplateWorkflow } from "../../features/type-templates/workflow.type";
import type { RecordTypeTemplate } from "../../features/type-templates/type";
import { TypeTemplateTile } from "../../features/type-templates/template-tile";

export function TypeTemplatesPage() {
  const navigate = useNavigate();
  const templateData = useAtomValue(typeTemplateDataAtom);
  const { templates } = templateData;
  const [workflow] = useState<TypeTemplateWorkflow>(() =>
    createTypeTemplateWorkflow({ storage }),
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RecordTypeTemplate>();
  const loading =
    templateData.status === "idle" || templateData.status === "loading";
  const loadError =
    templateData.status === "error" ? templateData.error : undefined;

  useEffect(() => {
    updateTypeTemplateData((current) =>
      current.status === "idle"
        ? { ...current, status: "loading", error: undefined }
        : current,
    );
    void workflow
      .list()
      .then((items) => {
        updateTypeTemplateData((current) => ({
          ...current,
          templates: items,
          status: "ready",
          error: undefined,
        }));
      })
      .catch((error: unknown) => {
        updateTypeTemplateData((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
      });
  }, [workflow]);

  function openNew() {
    setEditing(undefined);
    setEditorOpen(true);
  }

  function openEdit(template: RecordTypeTemplate) {
    setEditing(template);
    setEditorOpen(true);
  }

  async function saveTemplate(template: RecordTypeTemplate) {
    await workflow.save(template, editing?.type);
    updateTypeTemplateData((current) => ({
      ...current,
      templates: [...current.templates.filter((item) => item.type !== template.type), template]
        .sort((left, right) => left.type.localeCompare(right.type)),
      status: "ready",
      error: undefined,
    }));
    setEditorOpen(false);
    setEditing(undefined);
    void refreshSyncIndicator().catch(() => {});
    toaster.create({ title: "类型模板已保存", type: "success" });
  }

  async function deleteTemplate(type: string) {
    await workflow.remove(type);
    updateTypeTemplateData((current) => ({
      ...current,
      templates: current.templates.filter((item) => item.type !== type),
      status: "ready",
      error: undefined,
    }));
    setEditorOpen(false);
    setEditing(undefined);
    void refreshSyncIndicator().catch(() => {});
    toaster.create({ title: "类型模板已删除", type: "success" });
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditing(undefined);
  }

  return (
    <Box flex="1" minH="0" overflowY="auto" px="md" py="md">
      <Flex direction="column" gap="lg">
        <Grid templateColumns="1fr auto 1fr" alignItems="center" width="full">
          <IconButton
            variant="plain"
            aria-label="返回设置"
            justifySelf="start"
            onClick={() => void navigate({ to: "/settings" })}
          >
            <Icon as={LuArrowLeft} boxSize="5" />
          </IconButton>
          <Text textStyle="lg" fontWeight="semibold">
            类型模板
          </Text>
          <Button
            variant="subtle"
            justifySelf="end"
            onClick={openNew}
          >
            <Icon as={LuPlus} />
            添加
          </Button>
        </Grid>

        {loading ? (
          <Flex
            justify="center"
            align="center"
            gap="sm"
            py="2xl"
            color="fg.muted"
          >
            <Spinner size="sm" />
            <Text textStyle="sm">加载中…</Text>
          </Flex>
        ) : loadError ? (
          <Text textStyle="sm" color="fg.error">
            加载失败：{loadError}
          </Text>
        ) : templates.length === 0 ? (
          <Text
            width="full"
            textAlign="center"
            textStyle="sm"
            color="fg.muted"
            py="xl"
          >
            暂无类型模板
          </Text>
        ) : (
          <Grid templateColumns="repeat(4, minmax(0, 1fr))" gap="sm">
            {templates.map((template) => (
              <TypeTemplateTile
                key={template.type}
                icon={template.icon}
                label={template.type}
                surface="page"
                onClick={() => openEdit(template)}
              />
            ))}
          </Grid>
        )}
      </Flex>

      <TypeTemplateEditor
        open={editorOpen}
        template={editing}
        existingTypes={templates.map((template) => template.type)}
        onClose={closeEditor}
        onSaved={saveTemplate}
        onDeleted={deleteTemplate}
      />
    </Box>
  );
}
