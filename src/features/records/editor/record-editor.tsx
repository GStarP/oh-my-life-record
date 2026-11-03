import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import {
  Box,
  Button,
  Dialog,
  Drawer,
  Field,
  Flex,
  Icon,
  IconButton,
  Input,
  Spinner,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { LuTrash2, LuX } from "react-icons/lu";
import { ulid } from "ulidx";
import { releaseImages } from '../images/image-import'
import type { DraftImage } from '../images/image-import.type'
import { RecordImage } from '../images/record-image'
import { parseDateTimeInput, formatDateTimeInput } from "../../../utils/time";
import { toaster } from "../../notifications/toaster";
import {
  attributesToRows,
  createAttributeRow,
  isValidAttributeRows,
  rowsToAttributes,
} from "./attribute-model";
import type {
  AttributeRow,
  AttributeValueType,
} from './attribute-model.type'
import { AttributeValueInput } from './attribute-input'
import type {
  DeleteTarget,
  EditableImageProps,
  RecordEditorProps,
  RecordEditorValues,
} from './record-editor.type'

function resizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  // scrollHeight 不含边框，border-box 高度需要补上这部分。
  element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
}

function EditableImage({
  id,
  draft,
  store,
  onRemove,
}: EditableImageProps) {
  return (
    <Box
      position="relative"
      boxSize="20"
      flexShrink="0"
      borderRadius="lg"
      overflow="hidden"
    >
      <RecordImage
        src={draft?.url}
        previewSrc={draft?.previewUrl}
        imageId={draft ? undefined : id}
        imageStore={store}
        boxSize="full"
        borderRadius="lg"
      />
      <IconButton
        type="button"
        aria-label="删除图片"
        size="2xs"
        position="absolute"
        top="0"
        right="0"
        zIndex="1"
        borderRadius="lg"
        bg="bg.inverted/64"
        color="fg.inverted"
        _hover={{ bg: "bg.inverted/76" }}
        onClick={onRemove}
      >
        <Icon as={LuX} boxSize="4" />
      </IconButton>
    </Box>
  );
}

export function RecordEditor({
  open,
  record,
  initialType,
  template,
  onClose,
  onPickImages,
  imageStore,
  onSaved,
  onDeleted,
}: RecordEditorProps) {
  const formId = useId();
  const session = useRef(0);
  const draftRef = useRef<DraftImage[]>([]);
  const [drafts, setDrafts] = useState<DraftImage[]>([]);
  const [rows, setRows] = useState<AttributeRow[]>([]);
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [imagePreparing, setImagePreparing] = useState(false);
  const [recordDeleting, setRecordDeleting] = useState(false);
  const [attributeTypeOpen, setAttributeTypeOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(undefined);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const imagePreparationRef = useRef<Promise<void> | undefined>(undefined);
  const committingRef = useRef(false);
  const committedRef = useRef(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isValid, isSubmitting },
  } = useForm<RecordEditorValues>({
    mode: "onChange",
    defaultValues: {
      time: formatDateTimeInput(new Date()),
      type: "",
      name: "",
      description: "",
    },
  });
  const descriptionField = register("description");

  useEffect(() => {
    session.current++;
    imagePreparationRef.current = undefined;
    releaseImages(draftRef.current);
    draftRef.current = [];
    setDrafts([]);
    if (!open) return;
    setImageIds(record?.images ?? []);
    reset({
      time: formatDateTimeInput(record?.time ?? new Date()),
      type: record?.type ?? initialType ?? "",
      name: record?.name ?? "",
      description: record?.description ?? "",
    });
    setRows(attributesToRows(record?.attributes ?? {}, template));
    setDeleteTarget(undefined);
    setImagePreparing(false);
    setRecordDeleting(false);
    committingRef.current = false;
    committedRef.current = false;
  }, [open, record?.id, initialType, template, reset]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() =>
      resizeTextarea(descriptionRef.current),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [open, record?.id]);

  const attributesValid = useMemo(() => isValidAttributeRows(rows), [rows]);

  function updateRow(id: string, update: (row: AttributeRow) => AttributeRow) {
    setRows((current) =>
      current.map((row) => (row.id === id ? update(row) : row)),
    );
  }

  function addAttribute(valueType: AttributeValueType) {
    setRows((current) => [...current, createAttributeRow(valueType)]);
    setAttributeTypeOpen(false);
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (target?.kind === "image") {
      const removed = draftRef.current.filter((image) => image.id === target.id);
      releaseImages(removed);
      draftRef.current = draftRef.current.filter((image) => image.id !== target.id);
      setDrafts([...draftRef.current]);
      setImageIds((current) => current.filter((imageId) => imageId !== target.id));
      setDeleteTarget(undefined);
      return;
    }
    if (target?.kind === "attribute") {
      setRows((current) => current.filter((row) => row.id !== target.id));
      setDeleteTarget(undefined);
      return;
    }
    if (target?.kind !== "record" || !record || recordDeleting) return;
    setRecordDeleting(true);
    committingRef.current = true;
    try {
      await onDeleted(record);
      committedRef.current = true;
      setDeleteTarget(undefined);
    } catch (error) {
      committingRef.current = false;
      toaster.create({
        title:
          "删除失败：" +
          (error instanceof Error ? error.message : String(error)),
        type: "error",
      });
    } finally {
      setRecordDeleting(false);
    }
  }

  async function handleSave(values: RecordEditorValues) {
    // 顶部按钮与键盘提交共用此入口；取消或提交已经开始时不能重复写入。
    if (
      recordDeleting || committingRef.current || committedRef.current ||
      !attributesValid
    ) return;
    if (imagePreparing || imagePreparationRef.current) return;

    const time = record && values.time === formatDateTimeInput(record.time) ? record.time : parseDateTimeInput(values.time);
    if (Number.isNaN(time.getTime())) {
      toaster.create({ title: "时间格式不正确", type: "error" });
      return;
    }
    const saved = {
      id: record?.id ?? ulid(),
      time,
      type: values.type.trim(),
      name: values.name.trim(),
      description: values.description.trim(),
      images: imageIds,
      attributes: rowsToAttributes(rows),
    };
    committingRef.current = true;
    try {
      await onSaved(saved, draftRef.current.filter((image) => imageIds.includes(image.id)));
      committedRef.current = true;
    } catch (error) {
      committingRef.current = false;
      toaster.create({
        title:
          "保存失败：" +
          (error instanceof Error ? error.message : String(error)),
        type: "error",
      });
    }
  }

  function handleClose() {
    if (isSubmitting || recordDeleting || committingRef.current) return;
    session.current++;
    releaseImages(draftRef.current);
    draftRef.current = [];
    setDrafts([]);
    imagePreparationRef.current = undefined;
    onClose();
  }

  async function handlePickImages() {
    if (imagePreparing || imagePreparationRef.current || committingRef.current || recordDeleting) return;
    const currentSession = session.current;
    setImagePreparing(true);
    const task = (async () => {
      try {
        const images = await onPickImages();
        if (session.current !== currentSession) { releaseImages(images); return; }
        draftRef.current.push(...images);
        setDrafts([...draftRef.current]);
        setImageIds((current) => [...current, ...images.map((image) => image.id)]);
      } catch (error) {
        if (session.current === currentSession) toaster.create({ title: '准备图片失败：' + (error instanceof Error ? error.message : String(error)), type: 'error' });
      }
    })();
    imagePreparationRef.current = task;
    try { await task; } finally {
      if (session.current === currentSession) { imagePreparationRef.current = undefined; setImagePreparing(false); }
    }
  }

  const title = record ? "编辑记录" : "新建记录";
  const busy = isSubmitting || recordDeleting;
  return (
    <>
      <Drawer.Root
        open={open}
        placement="bottom"
        size="lg"
        closeOnInteractOutside={!busy}
        closeOnEscape={!busy}
        onOpenChange={(event) => {
          if (!event.open) void handleClose();
        }}
      >
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content
            bg="bg.panel"
            borderTopRadius="2xl"
            maxH="90dvh"
            aria-busy={busy}
          >
            <Drawer.Header>
              <Flex align="center" justify="space-between" width="full">
                <Drawer.Title textStyle="lg">{title}</Drawer.Title>
                <Button
                  type="submit"
                  form={formId}
                  variant="plain"
                  flexShrink={0}
                  disabled={!isValid || !attributesValid || imagePreparing || busy}
                  loading={isSubmitting}
                  loadingText="保存中"
                  aria-busy={isSubmitting}
                >
                  保存
                </Button>
              </Flex>
            </Drawer.Header>
            <Drawer.Body
              overflowY="auto"
              pb="3xl"
              pointerEvents={busy ? "none" : "auto"}
            >
              <Box
                as="form"
                id={formId}
                display="flex"
                flexDirection="column"
                gap="lg"
                onSubmit={handleSubmit(handleSave)}
              >
                <fieldset disabled={busy} style={{ display: "contents" }}>
                  <Field.Root>
                    <Field.Label textStyle="sm">时间</Field.Label>
                    <Input
                      type="datetime-local"
                      {...register("time", { required: true })}
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label textStyle="sm">类型</Field.Label>
                    <Input
                      readOnly={template !== undefined}
                      bg={template !== undefined ? "bg.muted" : undefined}
                      {...register(
                        "type",
                        template
                          ? {
                              required: "请输入类型",
                              validate: (value) =>
                                value.trim().length > 0 || "请输入类型",
                            }
                          : {},
                      )}
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label textStyle="sm">名称</Field.Label>
                    <Input {...register("name")} />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label textStyle="sm">描述</Field.Label>
                    <Textarea
                      {...descriptionField}
                      rows={1}
                      minH="10"
                      resize="none"
                      overflow="hidden"
                      ref={(element) => {
                        descriptionField.ref(element);
                        descriptionRef.current = element;
                        resizeTextarea(element);
                      }}
                      onInput={(event) => resizeTextarea(event.currentTarget)}
                    />
                  </Field.Root>

                  <Box>
                    <Flex align="center" justify="space-between" mb="sm">
                      <Text textStyle="sm" color="fg.muted">
                        属性
                      </Text>
                      <Button
                        type="button"
                        variant="subtle"
                        onClick={() => setAttributeTypeOpen(true)}
                      >
                        添加
                      </Button>
                    </Flex>
                    <Flex direction="column" gap="md">
                      {rows.map((row) => (
                        <Flex
                          key={row.id}
                          align="center"
                          gap="xs"
                          width="full"
                        >
                          <Input
                            width="20"
                            flexShrink="0"
                            readOnly={row.locked}
                            bg={row.locked ? "bg.muted" : undefined}
                            value={row.key}
                            onChange={(event) =>
                              updateRow(row.id, (current) => ({
                                ...current,
                                key: event.target.value,
                              }))
                            }
                          />
                          <AttributeValueInput
                            row={row}
                            onChange={(value) =>
                              updateRow(row.id, (current) => ({
                                ...current,
                                value,
                              }))
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            flexShrink="0"
                            aria-label="删除属性"
                            disabled={row.locked}
                            onClick={() => setDeleteTarget({ kind: "attribute", id: row.id })}
                          >
                            <Icon as={LuTrash2} boxSize="4" />
                          </Button>
                        </Flex>
                      ))}
                    </Flex>
                  </Box>

                  <Box>
                    <Flex align="center" justify="space-between" mb="sm">
                      <Text textStyle="sm" color="fg.muted">
                        图片
                      </Text>
                      <Button
                        type="button"
                        variant="subtle"
                        disabled={imagePreparing}
                        onClick={() => void handlePickImages()}
                      >
                        {imagePreparing ? <Spinner size="sm" /> : "添加"}
                      </Button>
                    </Flex>
                    {imageIds.length > 0 && (
                      <Flex
                        width="full"
                        align="stretch"
                        gap="sm"
                        overflowX="auto"
                        pb="xs"
                      >
                        {imageIds.map((imageId) => {
                          const draft = drafts.find((image) => image.id === imageId);
                          return (
                            <EditableImage
                              key={imageId}
                              id={imageId}
                              draft={draft}
                              store={imageStore}
                              onRemove={() => setDeleteTarget({ kind: "image", id: imageId })}
                            />
                          );
                        })}
                      </Flex>
                    )}
                  </Box>

                  {record && (
                    <Button
                      type="button"
                      variant="subtle"
                      colorPalette="red"
                      disabled={busy}
                      onClick={() => setDeleteTarget({ kind: "record" })}
                    >
                      删除
                    </Button>
                  )}
                </fieldset>
              </Box>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Drawer.Root>

      <Drawer.Root
        open={attributeTypeOpen}
        placement="bottom"
        size="sm"
        onOpenChange={(event) => setAttributeTypeOpen(event.open)}
      >
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content bg="bg.panel" borderTopRadius="2xl">
            <Drawer.Header>
              <Drawer.Title textStyle="md">选择属性类型</Drawer.Title>
            </Drawer.Header>
            <Drawer.Body pb="2xl">
              <Flex direction="column" gap="sm">
                <Button variant="subtle" onClick={() => addAttribute("text")}>
                  文本
                </Button>
                <Button variant="subtle" onClick={() => addAttribute("number")}>
                  数值
                </Button>
                <Button
                  variant="subtle"
                  onClick={() => addAttribute("boolean")}
                >
                  布尔
                </Button>
              </Flex>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Drawer.Root>

      <Dialog.Root
        open={deleteTarget !== undefined}
        onOpenChange={(event) => {
          if (!event.open && !recordDeleting) setDeleteTarget(undefined);
        }}
        onEscapeKeyDown={(event) => {
          if (recordDeleting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (recordDeleting) event.preventDefault();
        }}
      >
        <Dialog.Backdrop />
        <Dialog.Positioner alignItems="center" justifyContent="center">
          <Dialog.Content width="calc(100% - 2rem)" maxW="sm" bg="bg.panel">
            <Dialog.Header>
              <Dialog.Title textStyle="md">
                {deleteTarget?.kind === "image"
                  ? "删除图片"
                  : deleteTarget?.kind === "attribute" ? "删除属性" : "删除记录"}
              </Dialog.Title>
            </Dialog.Header>
            {deleteTarget?.kind === "image" && (
              <Dialog.Body>
                <Text>确定从当前记录中移除这张图片吗？保存记录后生效。</Text>
              </Dialog.Body>
            )}
            <Dialog.Footer>
              <Flex width="full" gap="sm">
                <Button
                  flex="1"
                  variant="plain"
                  disabled={recordDeleting}
                  onClick={() => setDeleteTarget(undefined)}
                >
                  取消
                </Button>
                <Button
                  flex="1"
                  colorPalette="red"
                  disabled={recordDeleting}
                  onClick={confirmDelete}
                >
                  {recordDeleting ? (
                    <Flex align="center" gap="xs">
                      <Spinner size="sm" />
                      <Text>删除中</Text>
                    </Flex>
                  ) : (
                    "删除"
                  )}
                </Button>
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </>
  );
}
