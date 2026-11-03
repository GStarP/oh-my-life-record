/** 限制调用者等待时间；有副作用的任务还需由所属模块终止或隔离。 */
export async function withDeadline<T>(work: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds) })])
  } finally { clearTimeout(timer) }
}
