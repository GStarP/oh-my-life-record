/**
 * 云端凭证配置弹窗（全屏）。
 *
 * 仅由用户打开，允许空表单取消；断网与验证失败不阻断本地使用。
 *
 * 表单草稿实时写入 localStorage，但只有真实连接验证成功才会进入可用凭证 atom。
 */
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Icon,
  Input,
  Spinner,
} from '@chakra-ui/react'
import { LuDatabase } from 'react-icons/lu'
import { useAtom } from 'jotai'
import { credentialAtom } from '../state'
import { cloudErrorMessage } from '../request-error'
import {
  getCredentialDraft,
  setCredential,
  setCredentialDraft,
} from './credential'
import { verifyCredential } from './verify'
import { toaster } from '../../notifications/toaster'
import { R2CloudAdapter } from '../r2/r2'
import { PasswordInput } from '../../../design-system/components/password-input'
import type {
  CredentialDraft,
  CredentialModalProps,
  CredentialModalState,
} from './credential.type'

export function CredentialModal({
  open,
  onClose,
}: CredentialModalProps) {
  const [credential, setAtomCredential] = useAtom(credentialAtom)
  const [state, setState] = useState<CredentialModalState>('idle')
  const contentRef = useRef<HTMLDivElement>(null)
  const validationGeneration = useRef(0)
  const initialDraft = getCredentialDraft()

  const { register, control, handleSubmit, reset, formState: { isValid } } =
    useForm<CredentialDraft>({
      mode: 'onChange',
      defaultValues: {
        endpoint: initialDraft?.endpoint ?? credential?.endpoint ?? '',
        bucket: initialDraft?.bucket ?? credential?.bucket ?? '',
        accessKeyId: initialDraft?.accessKeyId ?? credential?.accessKeyId ?? '',
        accessKeySecret:
          initialDraft?.accessKeySecret ?? credential?.accessKeySecret ?? '',
      },
    })

  const values = useWatch({ control })
  const lastPersisted = useRef('')
  const hydrating = useRef(false)

  // 只在弹窗从不可见变为可见时重置，避免每次实时持久化都把输入焦点/光标打断。
  useEffect(() => {
    if (!open) {
      validationGeneration.current++
      hydrating.current = false
      lastPersisted.current = ''
      return
    }
    const draft = getCredentialDraft()
    const nextValues: CredentialDraft = {
      endpoint: draft?.endpoint ?? credential?.endpoint ?? '',
      bucket: draft?.bucket ?? credential?.bucket ?? '',
      accessKeyId: draft?.accessKeyId ?? credential?.accessKeyId ?? '',
      accessKeySecret:
        draft?.accessKeySecret ?? credential?.accessKeySecret ?? '',
    }
    hydrating.current = true
    lastPersisted.current = JSON.stringify(nextValues)
    reset(nextValues)
    setState('idle')
  }, [open, reset])

  // useWatch 只依赖字段值；打开弹窗时的 reset 不算用户编辑，不写入草稿键。
  useEffect(() => {
    if (!open || hydrating.current) {
      hydrating.current = false
      return
    }
    const draft: CredentialDraft = {
      endpoint: values.endpoint ?? '',
      bucket: values.bucket ?? '',
      accessKeyId: values.accessKeyId ?? '',
      accessKeySecret: values.accessKeySecret ?? '',
    }
    const serialized = JSON.stringify(draft)
    if (serialized === lastPersisted.current) return
    lastPersisted.current = serialized
    setCredentialDraft(draft)
  }, [
    open,
    values.endpoint,
    values.bucket,
    values.accessKeyId,
    values.accessKeySecret,
  ])

  async function handleSave(valuesToSave: CredentialDraft) {
    const generation = ++validationGeneration.current
    setState('verifying')
    try {
      const full = { ...valuesToSave, bucket: valuesToSave.bucket.trim() }
      const result = await verifyCredential(new R2CloudAdapter(full))
      if (generation !== validationGeneration.current) return
      if (result.ok) {
        setCredential(full)
        setAtomCredential(full)
        setState('idle')
        onClose()
        return
      }

      toaster.create({ title: result.message, type: 'error' })
    } catch (error) {
      if (generation === validationGeneration.current) {
        toaster.create({ title: cloudErrorMessage(error), type: 'error' })
      }
    } finally {
      if (generation === validationGeneration.current) setState('idle')
    }
  }

  function handleCancel() {
    // 同步失效本轮验证：取消之后，即使旧请求成功也不能保存凭证或弹 toast。
    validationGeneration.current++
    setState('idle')
    onClose()
  }

  return (
    <Dialog.Root
      open={open}
      size="full"
      initialFocusEl={() => contentRef.current}
      onOpenChange={(event) => {
        if (!event.open) handleCancel()
      }}
    >
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content
          ref={contentRef}
          minH="100dvh"
          p="0"
          px="3xl"
          display="flex"
          flexDirection="column"
          overflowY="auto"
          bg="bg.muted"
        >
          <Flex flex="1" />
          <Flex
            as="form"
            direction="column"
            gap="3xl"
            align="center"
            width="full"
            maxW="80"
            mx="auto"
            onSubmit={handleSubmit(handleSave)}
          >
            <Flex direction="column" gap="sm" align="center">
              <Box
                boxSize="16"
                rounded="2xl"
                bg="bg.panel"
                display="flex"
                alignItems="center"
                justifyContent="center"
              >
                <Icon as={LuDatabase} boxSize="8" />
              </Box>
              <Dialog.Title textStyle="xl" fontWeight="semibold">
                云端配置
              </Dialog.Title>
            </Flex>
            <Flex direction="column" gap="md" width="full">
              <Field.Root disabled={state === 'verifying'}>
                <Field.Label>端点</Field.Label>
                <Input
                  type="url"
                  variant="subtle"
                  bg="bg.panel"
                  rounded="sm"
                  placeholder="https://<account-id>.r2.cloudflarestorage.com"
                  {...register('endpoint', { required: true })}
                />
              </Field.Root>
              <Field.Root disabled={state === 'verifying'}>
                <Field.Label>Access Key ID</Field.Label>
                <Input
                  variant="subtle"
                  bg="bg.panel"
                  rounded="sm"
                  {...register('accessKeyId', { required: true })}
                />
              </Field.Root>
              <Field.Root disabled={state === 'verifying'}>
                <Field.Label>Access Key Secret</Field.Label>
                <PasswordInput
                  variant="subtle"
                  bg="bg.panel"
                  rounded="sm"
                  {...register('accessKeySecret', { required: true })}
                />
              </Field.Root>
              <Field.Root disabled={state === 'verifying'}>
                <Field.Label>桶名</Field.Label>
                <Input
                  variant="subtle"
                  bg="bg.panel"
                  rounded="sm"
                  placeholder="omlr-test"
                  {...register('bucket', {
                    required: true,
                    validate: (value) => value.trim().length > 0,
                  })}
                />
              </Field.Root>
              <Button
                type="submit"
                width="full"
                rounded="sm"
                mt="3xl"
                disabled={!isValid || state === 'verifying'}
              >
                {state === 'verifying' ? <Spinner boxSize="4" /> : '连接'}
              </Button>
              <Button type="button" variant="ghost" onClick={handleCancel}>
                取消
              </Button>
            </Flex>
          </Flex>
          <Flex flex="2" />
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}
