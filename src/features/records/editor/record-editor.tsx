/**
 * 记录编辑 bottom sheet。
 *
 * 记录字段交给 react-hook-form；属性编辑器保留一个轻量行模型，保存时再收敛
 * 回 LifeRecord.attributes。图片暂存由页面注入，图片展示由 ImageManager 统一管理。
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
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
import { Image } from "../../../design-system/components/image";
import { parseDateTimeInput, formatDateTimeInput } from "../../../utils/time";
import { toaster } from "../../notifications/toaster";
import { useImageSources } from '../images/use-image-sources'
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
  source,
  onError,
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
      <Image
        src={source?.kind === "ready" ? source.url : undefined}
        alt="记录图片"
        width="full"
        height="full"
        borderRadius="lg"
        objectFit="cover"
        draggable={false}
        onError={onError}
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
  onDiscard,
  onUploadImages,
  imageManager,
  onSaved,
  onDeleted,
}: RecordEditorProps) {
  const [rows, setRows] = useState<AttributeRow[]>([]);
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [imageUploading, setImageUploading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [recordDeleting, setRecordDeleting] = useState(false);
  const [attributeTypeOpen, setAttributeTypeOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(undefined);
  const [deleteAttributeId, setDeleteAttributeId] = useState<
    string | undefined
  >();
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageUploadPromiseRef = useRef<Promise<void> | undefined>(undefined);
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
  const {
    sources: imageSources,
    addStagedImages,
    invalidateImage,
  } = useImageSources(imageManager, imageIds, open);

  function removeImage(id: string) {
    const next = imageIds.filter((imageId) => imageId !== id);
    setImageIds(next);
  }

  function handleImageError(id: string) {
    invalidateImage(id);
  }

  useEffect(() => {
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
    setDeleteAttributeId(undefined);
    setImageUploading(false);
    setClosing(false);
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

  function requestDelete(target: Exclude<DeleteTarget, undefined>, id?: string) {
    setDeleteTarget(target);
    if (target === "attribute") setDeleteAttributeId(id);
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (target === "attribute") {
      setDeleteTarget(undefined);
      if (deleteAttributeId) {
        setRows((current) =>
          current.filter((row) => row.id !== deleteAttributeId),
        );
      }
      setDeleteAttributeId(undefined);
      return;
    }
    if (target !== "record" || !record || recordDeleting) return;
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
    // 暂存图片是表单数据的一部分；若用户在压缩/写入 IndexedDB 完成前
    // 提交，imageIds 仍是旧快照，刚选中的图片会从记录中丢失。
    if (imageUploading || imageUploadPromiseRef.current) return

    const time = parseDateTimeInput(values.time);
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
      await onSaved(saved, record?.time);
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

  async function handleClose() {
    if (closing) return;
    setClosing(true);
    // 取消动作先等当前批次落库，再做立即孤儿清理，
    // 避免「清理先结束、图片后写入」留下刚刚选中的孤儿 Blob。
    try {
      await imageUploadPromiseRef.current;
      if (!committingRef.current && !committedRef.current) {
        try {
          await onDiscard();
        } catch (error) {
          toaster.create({
            title:
              "清理图片失败：" +
              (error instanceof Error ? error.message : String(error)),
            type: "error",
          });
        }
      }
      committedRef.current = false;
      committingRef.current = false;
      onClose();
    } finally {
      setClosing(false);
    }
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setImageUploading(true);
    const uploadTask = (async () => {
      try {
        const staged = await onUploadImages(files);
        addStagedImages(staged);
        setImageIds((current) => [
          ...current,
          ...staged.map((image) => image.id),
        ]);
      } catch (error) {
        toaster.create({
          title:
            "图片上传失败：" +
            (error instanceof Error ? error.message : String(error)),
          type: "error",
        });
      }
    })();
    imageUploadPromiseRef.current = uploadTask;
    try {
      await uploadTask;
    } finally {
      if (imageUploadPromiseRef.current === uploadTask) {
        imageUploadPromiseRef.current = undefined;
      }
      setImageUploading(false);
    }
  }

  const title = record ? "编辑记录" : "新建记录";
  return (
    <>
      <Drawer.Root
        open={open}
        placement="bottom"
        size="lg"
        closeOnInteractOutside={false}
        closeOnEscape={false}
        onOpenChange={() => {}}
      >
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content
            bg="bg.panel"
            borderTopRadius="2xl"
            maxH="90dvh"
            aria-busy={closing}
          >
              <Drawer.Header>
              <Flex align="center" justify="space-between" width="full">
                <Drawer.Title textStyle="lg">{title}</Drawer.Title>
                <Button
                  type="button"
                  variant="plain"
                  disabled={closing || isSubmitting || recordDeleting}
                  onClick={() => void handleClose()}
                >
                  {closing ? (
                    <Flex align="center" gap="xs">
                      <Spinner size="sm" />
                      <Text textStyle="sm">清理中…</Text>
                    </Flex>
                  ) : (
                    "取消"
                  )}
                </Button>
              </Flex>
            </Drawer.Header>
            <Drawer.Body
              overflowY="auto"
              pb="3xl"
              pointerEvents={closing || recordDeleting ? "none" : "auto"}
            >
              <Box
                as="form"
                display="flex"
                flexDirection="column"
                gap="lg"
                onSubmit={handleSubmit(handleSave)}
              >
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
                          onClick={() => requestDelete("attribute", row.id)}
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
                      disabled={imageUploading}
                      onClick={() => imageInputRef.current?.click()}
                    >
                      {imageUploading ? <Spinner size="sm" /> : "上传"}
                    </Button>
                  </Flex>
                  <Input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*,.heic,.heif"
                    multiple
                    display="none"
                    onChange={handleImageChange}
                  />
                  {imageIds.length > 0 && (
                    <Flex
                      width="full"
                      align="stretch"
                      gap="sm"
                      overflowX="auto"
                      pb="xs"
                    >
                      {imageIds.map((imageId) => {
                        const source = imageSources[imageId];
                        return (
                          <EditableImage
                            key={imageId}
                            source={source}
                            onError={() => handleImageError(imageId)}
                            onRemove={() => removeImage(imageId)}
                          />
                        );
                      })}
                    </Flex>
                  )}
                </Box>

                <Flex direction="column" gap="sm">
                  <Button
                    type="submit"
                    disabled={
                      !isValid ||
                      !attributesValid ||
                      imageUploading ||
                      isSubmitting
                    }
                  >
                    {isSubmitting ? (
                      <Flex align="center" gap="xs">
                        <Spinner size="sm" />
                        <Text>保存中</Text>
                      </Flex>
                    ) : (
                      '保存'
                    )}
                  </Button>
                  {record && (
                    <Button
                      type="button"
                      variant="subtle"
                      colorPalette="red"
                      disabled={recordDeleting || closing || isSubmitting}
                      onClick={() => requestDelete("record")}
                    >
                      删除
                    </Button>
                  )}
                </Flex>
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
                  {deleteTarget === "attribute" ? "删除属性" : "删除记录"}
                </Dialog.Title>
              </Dialog.Header>
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
