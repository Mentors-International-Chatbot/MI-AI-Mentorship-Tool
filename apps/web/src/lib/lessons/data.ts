// ─── Lesson Data ─────────────────────────────────────────────────────
// Structured curriculum for lessons 1-5 (Financial Management).
// Each lesson has a variable number of messages — the router and builder
// read messages.length dynamically; nothing assumes a fixed count.

export interface LessonMessage {
  order: number;
  type: 'escenario' | 'explicación' | 'ejemplo' | 'pregunta' | 'profundización';
  contentEs: string;
}

export interface LessonData {
  lessonNumber: number;
  titleEs: string;
  category: string;
  keyConcepts: string[];
  selfCheckQuestions: string[];
  exercise: string;
  commitment: string;
  messages: LessonMessage[];
}

const LESSONS: Record<number, LessonData> = {
  1: {
    lessonNumber: 1,
    titleEs: 'Registros Financieros',
    category: 'Gestión Financiera',
    keyConcepts: [
      'Un registro financiero es una herramienta donde anotas todos los ingresos y gastos de tu negocio cada día.',
      'Ingreso: el dinero que entra por ventas o servicios.',
      'Gasto: el dinero que sale por compras, arriendo, transporte, deudas, etc.',
      'Resultado: lo que queda al restar los gastos de los ingresos. Puede ser ganancia o pérdida.',
      'Fórmula diaria: Ingresos - Gastos = Resultado del día.',
    ],
    selfCheckQuestions: [
      '¿Llevo un registro del dinero que entra y sale de mi negocio?',
      '¿Sé cuánto gané o perdí el mes pasado?',
      '¿Reviso mis notas para saber a dónde va el dinero del negocio?',
      '¿Mi negocio puede funcionar sin mí por un tiempo?',
    ],
    exercise: 'Anota todos los ingresos y gastos de tu negocio cada día durante una semana. Al final de cada día, resta los gastos de los ingresos para saber tu resultado diario. Al final de la semana, suma los resultados para ver cómo te fue.',
    commitment: 'Voy a anotar todos los ingresos y gastos de mi negocio por una semana, todos los días. Voy a revisar mis notas al final de cada día.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Imagina que al final del mes sientes que trabajaste mucho, pero no sabes si realmente ganaste plata o la perdiste. Eso pasa cuando no anotamos lo que entra y sale del negocio. Hoy vamos a aprender a llevar un registro financiero para que siempre sepas cómo va tu negocio.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Un registro financiero es simplemente anotar cada día cuánto dinero entra (por ventas o servicios) y cuánto sale (compras, arriendo, transporte, deudas). Al final del día restas: Ingresos - Gastos = Resultado. Si el número es positivo, ganaste. Si es negativo, perdiste. Así de simple.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Por ejemplo: hoy vendiste empanadas por $60.000 y gastaste $45.000 en ingredientes y gas. Tu resultado del día es $60.000 - $45.000 = $15.000 de ganancia. Mañana haces lo mismo. Al final de la semana, sumas todos los resultados y sabes exactamente cómo te fue.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: 'Ahora te toca a ti: esta semana, anota cada día cuánto vendiste y cuánto gastaste en tu negocio. Puede ser en un cuaderno, en el celular, donde quieras. ¿En qué vas a anotar tus registros esta semana?',
      },
    ],
  },
  2: {
    lessonNumber: 2,
    titleEs: 'Entidades Separadas',
    category: 'Gestión Financiera',
    keyConcepts: [
      'Tu negocio y tú son dos "personas" diferentes con plata diferente.',
      'Mezclar la plata personal con la del negocio hace imposible saber si el negocio realmente gana o pierde.',
      'Separar las finanzas significa tener registros, cuentas o lugares diferentes para el dinero personal y el del negocio.',
      'Ponerte un sueldo fijo del negocio te ayuda a controlar los gastos personales y saber cuánto realmente gana el negocio.',
    ],
    selfCheckQuestions: [
      '¿Separo el dinero del negocio del dinero personal?',
      '¿Separo los gastos del negocio de los gastos personales?',
      '¿Pago cuando uso inventario o servicios del negocio para uso personal?',
      '¿Me pongo un sueldo fijo del negocio?',
    ],
    exercise: 'Calcula cuánto necesitas al mes para tus gastos personales (comida, transporte, servicios, otros). Luego revisa si tu negocio puede cubrir ese sueldo sin perder. Define un sueldo inicial realista y anótalo como gasto fijo del negocio.',
    commitment: 'Voy a separar el dinero del negocio del dinero personal. Voy a ponerme un sueldo fijo y anotarlo como gasto del negocio.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: '¿Te ha pasado que vendes bien en la semana, pero al final del mes no sabes a dónde se fue la plata? Muchas veces pasa porque usamos la misma plata para el negocio y para la casa. Hoy vamos a aprender por qué es tan importante separar esas dos cosas.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Piensa en tu negocio como otra persona. Esa "persona" tiene sus propios gastos (ingredientes, arriendo, transporte) y sus propios ingresos (ventas). Cuando mezclas tu plata personal con la del negocio, no puedes saber si el negocio realmente está ganando. La solución: separa el dinero en dos lugares diferentes y ponte un sueldo fijo que el negocio te paga cada mes.',
      },
      {
        order: 3,
        type: 'pregunta',
        contentEs: 'Hagamos un ejercicio rápido: ¿cuánto necesitas al mes para tus gastos personales? Piensa en comida, transporte, servicios de la casa y otros gastos. Dime un número aproximado y vamos a ver si tu negocio puede darte ese sueldo.',
      },
    ],
  },
  3: {
    lessonNumber: 3,
    titleEs: 'Presupuesto del Negocio',
    category: 'Gestión Financiera',
    keyConcepts: [
      'Un presupuesto es un plan escrito de cuánto esperas ganar y gastar en un mes.',
      'Incluye: ingresos esperados (ventas), gastos fijos (arriendo, servicios, transporte), gastos variables (materia prima, empaque), y saldo esperado.',
      'El saldo esperado = Ingresos - Gastos. Si es positivo, puedes ahorrar o invertir. Si es negativo, necesitas ajustar.',
      'El presupuesto no es fijo — se puede ajustar si cambian los ingresos o gastos.',
    ],
    selfCheckQuestions: [
      '¿Planifico cuánto voy a gastar cada mes en mi negocio?',
      '¿Sé cuánto necesito vender para cubrir mis gastos?',
      '¿Reviso mi presupuesto al final del mes?',
      '¿Separo el presupuesto del negocio del presupuesto de la casa?',
    ],
    exercise: 'Crea un presupuesto mensual para tu negocio: anota cuánto esperas vender, cuáles son tus gastos fijos, cuáles tus gastos variables, y calcula el saldo esperado. Al final del mes, compara lo que planeaste con lo que pasó de verdad.',
    commitment: 'Voy a anotar cuánto espero vender y gastar este mes. Voy a alinear mis gastos con mi presupuesto. Voy a revisarlo al final del mes.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: '¿Alguna vez has llegado a mitad de mes y te das cuenta que ya no te alcanza la plata? Sin un plan, es muy fácil gastar más de lo que uno gana. Hoy vamos a aprender a hacer un presupuesto — que es como un mapa que te dice a dónde va tu dinero.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Un presupuesto es simplemente escribir cuánto esperas vender y cuánto vas a gastar este mes. Tienes gastos fijos (arriendo, servicios, transporte — los pagas vendas o no) y gastos variables (materia prima, empaque — dependen de cuánto vendas). Al restar todos los gastos de tus ventas esperadas, sabes si te va a alcanzar o si necesitas ajustar algo.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Ejemplo: si esperas vender $2.350.000 este mes, y tus gastos fijos son $1.400.000 y tus gastos variables $500.000, tu saldo sería $450.000. Esa plata la puedes ahorrar o invertir en el negocio. Si el saldo fuera negativo, sabrías que necesitas vender más o gastar menos.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: 'Ahora te toca: ¿cuánto crees que vas a vender este mes en tu negocio? Y ¿cuáles son tus gastos fijos principales? Dime los números que tengas y hacemos tu presupuesto juntos.',
      },
    ],
  },
  4: {
    lessonNumber: 4,
    titleEs: 'Ahorro',
    category: 'Gestión Financiera',
    keyConcepts: [
      'Ahorrar no es guardar lo que sobra — es apartar un porcentaje ANTES de gastar. La meta es mínimo el 10% de tus ingresos.',
      'Un fondo de emergencia es un ahorro especial para imprevistos (salud, reparaciones, accidentes). La meta es tener 3 meses de gastos guardados.',
      'Hay gastos esenciales (comida, vivienda, servicios), gastos del negocio (materiales, transporte), y gastos innecesarios (antojos, lujos). Identifica cuáles puedes reducir.',
      'El primer paso es anotar todos tus gastos de la semana y clasificarlos en esenciales y no esenciales.',
    ],
    selfCheckQuestions: [
      '¿Anoto lo que gasto y lo que gano cada semana?',
      '¿Guardo algo de dinero, por poco que sea?',
      '¿Tengo un fondo de emergencia?',
      '¿Planifico lo que voy a gastar antes de gastarlo?',
    ],
    exercise: 'Haz un presupuesto personal semanal: anota tus ingresos, luego separa gastos esenciales y no esenciales. Calcula cuánto puedes apartar para ahorro (mínimo 10%) y para tu fondo de emergencia.',
    commitment: 'Voy a crear un presupuesto mensual. Voy a apartar una parte de mis ingresos para ahorro. Voy a empezar un fondo de emergencia, aunque sea con poquito.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: '¿Qué harías si de repente necesitaras $100.000 para una emergencia? ¿Los tienes guardados? Muchos negocios y familias pasan dificultades porque no han planeado sus finanzas. Hoy vamos a hablar de cómo ahorrar de verdad — no con lo que sobra, sino con un plan.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'El secreto del ahorro es apartar el dinero ANTES de gastar, no después. La meta es guardar mínimo el 10% de lo que ganas. También necesitas un fondo de emergencia — un ahorro especial para imprevistos como problemas de salud o reparaciones. La meta es tener guardados 3 meses de gastos.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Para empezar, anota todos tus gastos de esta semana y clasifícalos: ¿cuáles son esenciales (comida, transporte, servicios) y cuáles no son tan necesarios (antojos, compras por impulso)? A veces descubrimos gastos pequeños que se acumulan sin darnos cuenta.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Hay algún gasto no esencial que podrías reducir esta semana? Piensa en algo pequeño que puedas recortar y usar esa plata para empezar tu ahorro. Cuéntame, ¿qué se te ocurre?',
      },
    ],
  },
  5: {
    lessonNumber: 5,
    titleEs: 'Punto de Equilibrio',
    category: 'Gestión Financiera',
    keyConcepts: [
      'El punto de equilibrio es la cantidad mínima de productos o servicios que necesitas vender para cubrir todos tus costos. Después de ese punto, empiezas a ganar.',
      'Gastos fijos (indirectos): los que pagas vendas o no — arriendo, servicios, transporte.',
      'Gastos variables (directos): los que cambian según cuánto produzcas — materiales, ingredientes, empaque.',
      'Margen = Precio de venta - Costo variable por unidad.',
      'Fórmula: Punto de equilibrio = Costos fijos / Margen por unidad.',
    ],
    selfCheckQuestions: [
      '¿Conozco los costos fijos de mi negocio?',
      '¿Sé cuánto me cuesta producir cada unidad de mi producto o servicio?',
      '¿Sé cuánto necesito vender para no perder dinero?',
      '¿Uso mi punto de equilibrio para fijar metas de ventas?',
    ],
    exercise: 'Calcula tu punto de equilibrio: 1) Anota tus costos fijos mensuales. 2) Calcula el costo variable por unidad. 3) Define tu precio de venta. 4) Aplica la fórmula: Costos fijos / (Precio - Costo variable) = unidades que necesitas vender.',
    commitment: 'Voy a calcular los costos fijos y variables de mi negocio. Voy a determinar mi punto de equilibrio. Voy a fijar una meta de ventas por encima de ese número.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: '¿Te has preguntado alguna vez si estás vendiendo lo suficiente? Puedes trabajar mucho y vender bastante, pero si no sabes cuánto necesitas vender para cubrir tus gastos, podrías estar perdiendo plata sin saberlo. Hoy vamos a aprender a calcular tu punto de equilibrio.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Tu negocio tiene dos tipos de gastos. Los fijos los pagas vendas o no: arriendo, servicios, transporte. Los variables cambian según cuánto vendas: ingredientes, materiales, empaque. El punto de equilibrio es la cantidad mínima que necesitas vender para cubrir TODOS esos gastos. La fórmula es: Costos fijos ÷ (Precio de venta - Costo variable por unidad).',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Ejemplo: Ana hace velas en su casa. Sus costos fijos son $300.000 al mes (arriendo, luz, gas). Cada vela le cuesta $3.000 en materiales y la vende a $8.000. Su margen es $5.000 por vela. Punto de equilibrio = $300.000 ÷ $5.000 = 60 velas. Ana necesita vender mínimo 60 velas al mes para no perder. Todo lo que venda después de 60 es ganancia.',
      },
      {
        order: 4,
        type: 'profundización',
        contentEs: 'La fórmula funciona igual para cualquier tipo de negocio. Si compras y revendes (como ropa o productos), el costo variable es lo que pagas por cada producto. Si ofreces servicios (como cortes de pelo o reparaciones), el costo variable son los materiales que usas en cada servicio. Lo importante es conocer tus dos tipos de costos.',
      },
      {
        order: 5,
        type: 'pregunta',
        contentEs: 'Hagamos tu cálculo: ¿cuánto pagas al mes en gastos fijos de tu negocio (arriendo, servicios, transporte)? Y ¿cuánto te cuesta producir o comprar una unidad de lo que vendes? Con esos números podemos calcular tu punto de equilibrio.',
      },
    ],
  },
};

export function getLessonData(lessonNumber: number): LessonData {
  const lesson = LESSONS[lessonNumber];
  if (!lesson) {
    throw new Error(`Lesson ${lessonNumber} not found. Only lessons 1-${Object.keys(LESSONS).length} are available.`);
  }
  return lesson;
}

export function getLessonTitle(lessonNumber: number): string {
  const lesson = LESSONS[lessonNumber];
  if (!lesson) return `Lección ${lessonNumber}`;
  return lesson.titleEs;
}

export function hasLessonData(lessonNumber: number): boolean {
  return lessonNumber in LESSONS;
}
